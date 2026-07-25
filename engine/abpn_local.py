"""DAMO local-retouching networks: blemish DETECTION + gated-conv INPAINTING.

`pytorch_model.pt` (used in abpn.py) only evens skin TONE — it reduces the
redness of a mark but leaves its structure. The actual removal lives in
`joint_20210926.pth`, which holds two more networks:

    detection_net  — trained to find what a retoucher would remove
    inpainting_net — gated-conv network that fills those regions

The detector is the important one: it is the learned JUDGEMENT we could not
hand-code. Every rule we wrote closed one failure and opened another.

Architecture reconstructed from the released weight shapes; module names match
the checkpoint so `load_state_dict(strict=True)` proves the reconstruction.

Weights: modelscope damo/cv_unet_skin_retouching_torch — Apache License 2.0.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class ConvBlock(nn.Module):
    """conv -> [bn] -> LeakyReLU (encoder uses stride 2)."""

    def __init__(self, in_ch, out_ch, k=3, s=1, p=1, bn=True, bias=False):
        super().__init__()
        self.conv = nn.Conv2d(in_ch, out_ch, k, s, p, bias=bias)
        self.bn = nn.BatchNorm2d(out_ch) if bn else None

    def forward(self, x):
        x = self.conv(x)
        if self.bn is not None:
            x = self.bn(x)
        return F.leaky_relu(x, 0.2, inplace=True)


class GatedBlock(nn.Module):
    """Gated convolution: features * sigmoid(gate) — lets the network learn
    which spatial positions are valid, which is what makes it work on holes."""

    def __init__(self, in_ch, out_ch, k=3, s=1, p=1, bn=True, act=True, bias=False):
        super().__init__()
        self.conv = nn.Conv2d(in_ch, out_ch, k, s, p, bias=bias)
        self.gate = nn.Conv2d(in_ch, out_ch, k, s, p, bias=bias)
        self.bn = nn.BatchNorm2d(out_ch) if bn else None
        self.act = act

    def forward(self, x):
        h = self.conv(x)
        g = torch.sigmoid(self.gate(x))
        if self.act:
            h = F.leaky_relu(h, 0.2, inplace=True)
        h = h * g
        if self.bn is not None:
            h = self.bn(h)
        return h


def _up(x, ref):
    return F.interpolate(x, size=ref.shape[2:], mode="nearest")


class DetectionUNet(nn.Module):
    def __init__(self, n_channels=3, n_classes=1):
        super().__init__()
        self.ec_images_1 = ConvBlock(n_channels, 64, s=2, bn=False)
        self.ec_images_2 = ConvBlock(64, 128, s=2)
        self.ec_images_3 = ConvBlock(128, 256, s=2)
        self.ec_images_4 = ConvBlock(256, 512, s=2)
        self.ec_images_5 = ConvBlock(512, 512, s=2)
        self.ec_images_6 = ConvBlock(512, 512, s=2)
        self.dc_images_6 = ConvBlock(1024, 512)
        self.dc_images_5 = ConvBlock(1024, 512)
        self.dc_images_4 = ConvBlock(768, 256)
        self.dc_images_3 = ConvBlock(384, 128)
        self.dc_images_2 = ConvBlock(192, 64)
        self.dc_images_1 = nn.Conv2d(64 + n_channels, n_classes, 1)

    def forward(self, x):
        e1 = self.ec_images_1(x)
        e2 = self.ec_images_2(e1)
        e3 = self.ec_images_3(e2)
        e4 = self.ec_images_4(e3)
        e5 = self.ec_images_5(e4)
        e6 = self.ec_images_6(e5)
        d = self.dc_images_6(torch.cat([_up(e6, e5), e5], 1))
        d = self.dc_images_5(torch.cat([_up(d, e4), e4], 1))
        d = self.dc_images_4(torch.cat([_up(d, e3), e3], 1))
        d = self.dc_images_3(torch.cat([_up(d, e2), e2], 1))
        d = self.dc_images_2(torch.cat([_up(d, e1), e1], 1))
        return self.dc_images_1(torch.cat([_up(d, x), x], 1))  # logits


class RetouchingNet(nn.Module):
    def __init__(self, in_channels=4, out_channels=3):
        super().__init__()
        self.ec_images_1 = GatedBlock(in_channels, 64, s=2, bn=False)
        self.ec_images_2 = GatedBlock(64, 128, s=2)
        self.ec_images_3 = GatedBlock(128, 256, s=2)
        self.ec_images_4 = GatedBlock(256, 512, s=2)
        self.ec_images_5 = GatedBlock(512, 512, s=2)
        self.ec_images_6 = GatedBlock(512, 512, s=2)
        self.dc_images_6 = GatedBlock(1024, 512)
        self.dc_images_5 = GatedBlock(1024, 512)
        self.dc_images_4 = GatedBlock(768, 256)
        self.dc_images_3 = GatedBlock(384, 128)
        self.dc_images_2 = GatedBlock(192, 64)
        self.dc_images_1 = GatedBlock(
            64 + in_channels, out_channels, bn=False, act=False, bias=True
        )

    def forward(self, image, mask):
        x = torch.cat([image, mask], 1)
        e1 = self.ec_images_1(x)
        e2 = self.ec_images_2(e1)
        e3 = self.ec_images_3(e2)
        e4 = self.ec_images_4(e3)
        e5 = self.ec_images_5(e4)
        e6 = self.ec_images_6(e5)
        d = self.dc_images_6(torch.cat([_up(e6, e5), e5], 1))
        d = self.dc_images_5(torch.cat([_up(d, e4), e4], 1))
        d = self.dc_images_4(torch.cat([_up(d, e3), e3], 1))
        d = self.dc_images_3(torch.cat([_up(d, e2), e2], 1))
        d = self.dc_images_2(torch.cat([_up(d, e1), e1], 1))
        return self.dc_images_1(torch.cat([_up(d, x), x], 1))


def load(weights_path: str, device: str = "cpu"):
    ckpt = torch.load(weights_path, map_location=device, weights_only=False)
    det = DetectionUNet(3, 1)
    det.load_state_dict(ckpt["detection_net"], strict=True)
    inp = RetouchingNet(4, 3)
    inp.load_state_dict(ckpt["inpainting_net"], strict=True)
    det.to(device).eval()
    inp.to(device).eval()
    return det, inp
