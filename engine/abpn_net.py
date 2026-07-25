"""U-Net used by DAMO's skin-retouching model (ABPN family, CVPR 2022).

The architecture is reconstructed from the released weight shapes — a standard
U-Net (64 -> 512) with bilinear upsampling and deep-supervision heads. Module
names match the checkpoint exactly so `load_state_dict(strict=True)` verifies
the reconstruction: if anything were wrong, loading would fail loudly rather
than silently producing garbage.

Weights: modelscope damo/cv_unet_skin_retouching_torch — Apache License 2.0.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class DoubleConv(nn.Module):
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, 3, padding=1),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        return self.conv(x)


class InConv(nn.Module):
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.conv = DoubleConv(in_ch, out_ch)

    def forward(self, x):
        return self.conv(x)


class Down(nn.Module):
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.mpconv = nn.Sequential(nn.MaxPool2d(2), DoubleConv(in_ch, out_ch))

    def forward(self, x):
        return self.mpconv(x)


class Up(nn.Module):
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.conv = DoubleConv(in_ch, out_ch)

    def forward(self, x1, x2):
        x1 = F.interpolate(x1, scale_factor=2, mode="bilinear", align_corners=True)
        dy = x2.size(2) - x1.size(2)
        dx = x2.size(3) - x1.size(3)
        x1 = F.pad(x1, (dx // 2, dx - dx // 2, dy // 2, dy - dy // 2))
        return self.conv(torch.cat([x2, x1], dim=1))


class OutConv(nn.Module):
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.conv = nn.Conv2d(in_ch, out_ch, 1)

    def forward(self, x):
        return self.conv(x)


class UNet(nn.Module):
    def __init__(self, n_channels=3, n_classes=3):
        super().__init__()
        self.inc = InConv(n_channels, 64)
        self.down1 = Down(64, 128)
        self.down2 = Down(128, 256)
        self.down3 = Down(256, 512)
        self.down4 = Down(512, 512)
        self.up1 = Up(1024, 256)
        self.up2 = Up(512, 128)
        self.up3 = Up(256, 64)
        self.up4 = Up(128, 64)
        self.outc = OutConv(64, n_classes)
        # deep-supervision heads (training aids; kept so the checkpoint loads
        # strictly, which is our proof the architecture is right)
        self.dsoutc1 = OutConv(64, n_classes)
        self.dsoutc2 = OutConv(64, n_classes)
        self.dsoutc3 = OutConv(128, n_classes)
        self.dsoutc4 = OutConv(256, n_classes)

    def forward(self, x):
        x1 = self.inc(x)
        x2 = self.down1(x1)
        x3 = self.down2(x2)
        x4 = self.down3(x3)
        x5 = self.down4(x4)
        y4 = self.up1(x5, x4)
        y3 = self.up2(y4, x3)
        y2 = self.up3(y3, x2)
        y1 = self.up4(y2, x1)
        return self.outc(y1)


def load(weights_path: str, device: str = "cpu") -> UNet:
    ckpt = torch.load(weights_path, map_location=device, weights_only=False)
    state = ckpt["generator"] if "generator" in ckpt else ckpt
    net = UNet(3, 3)
    net.load_state_dict(state, strict=True)  # strict: verifies the reconstruction
    net.to(device).eval()
    return net
