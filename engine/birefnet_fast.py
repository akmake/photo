"""BiRefNet-lite with its deformable convolutions rewritten — same maths, ~1.9x faster.

WHY. Subject detection is the most expensive thing a frame pays for the first
time (docs/SLOW.md S-10), and profiling the exported graph showed where: more
than half of every run went to fifteen DEFORMABLE convolutions in the decoder.
onnxruntime has no kernel for deform_conv2d, so the export emulates each one by
gathering the four bilinear corners of every sampling point through GatherND
over a [1, 1, 64, 49, 256, 256] tensor — 200 million floats, four times, plus
the transposes to lay them out again.

That is bilinear sampling of a zero-padded feature map at computed coordinates,
which is exactly what GridSample does (align_corners=1, zeros), in one pass and
without the corner tensors. Only that span of each block is replaced: the offset
convolution, the modulator and the final k x k stride-k convolution are left as
exported, and the new sampler writes the same tiled layout the old one did.

MEASURED on 20 frames from every project (docs/SLOW.md S-10): 6.13s -> 3.30s a
frame; the largest alpha difference anywhere 9e-5 on a 0..1 scale, and no pixel
anywhere moved by one level in 255. test_birefnet_fast.py holds that promise.

Derived by setup_models.py from models/birefnet_lite.onnx; needs `onnx`, not torch.
"""

import numpy as np
import onnx
from onnx import helper, numpy_helper


def derive(src, dst):
    """Write the rewritten graph to `dst`. -> number of blocks rewritten."""
    m = onnx.load(src)
    g = m.graph

    consts = {}
    for n in g.node:
        if n.op_type == "Constant":
            consts[n.output[0]] = numpy_helper.to_array(n.attribute[0].t)

    blocks = sorted({n.name.rsplit("atrous_conv/", 1)[0] + "atrous_conv/"
                     for n in g.node if "aspp_deforms" in n.name and "/atrous_conv/" in n.name})

    new_inits = []
    insert_before = {}   # consumer node name -> [new nodes]
    rename = {}          # old tensor -> new tensor

    def const(name, arr):
        new_inits.append(numpy_helper.from_array(np.asarray(arr), name))
        return name

    # Tied to THIS export's tensor names. A re-export that names them otherwise
    # fails here loudly instead of producing a different network.
    if not blocks:
        raise ValueError("no deformable blocks found — not the expected BiRefNet-lite export")

    for p in blocks:
        lay = consts[p + "Constant_46_output_0"].tolist()     # [1, C, kh, kw, H, W]
        padded = consts[p + "Constant_32_output_0"].tolist()  # [1, 1, C, Hp, Wp]
        _, C, kh, kw, H, W = lay
        Hp, Wp = padded[3], padded[4]
        # What the export already computes and we keep:
        #   coords  [1, 1, K, 2, H, W]  sampling point per tap, (y, x), in PADDED pixels
        #   mask    [1, K, H, W]        the modulator, 2 * sigmoid
        #   pad_out [1, C, Hp, Wp]      the input, zero-padded
        # and what it built them into, which the k x k stride-k conv reads:
        #   tiled   [1, C, H*kh, W*kw]  tap (a, b) of pixel (h, w) at (h*kh + a, w*kw + b)
        coords, mask, pad_out = p + "Add_output_0", p + "Mul_output_0", p + "Pad_output_0"
        tiled = p + "Reshape_20_output_0"
        q = p + "gs/"
        # GridSample wants (x, y) normalised to [-1, 1]; align_corners=1 maps
        # -1 and 1 to the centres of the first and last padded pixels, which is
        # the index space the GatherND lookups used. Outside the padded map both
        # read zero: GridSample by padding_mode, the export by clipping onto the
        # zero border.
        nodes = [
            helper.make_node("Reshape", [coords, const(q + "s0", np.array([1, kh, kw, 2, H, W], np.int64))], [q + "c0"], name=q + "c0"),
            helper.make_node("Transpose", [q + "c0"], [q + "c1"], perm=[0, 4, 1, 5, 2, 3], name=q + "c1"),
            helper.make_node("Reshape", [q + "c1", const(q + "s1", np.array([1, H * kh, W * kw, 2], np.int64))], [q + "c2"], name=q + "c2"),
            helper.make_node("Slice", [q + "c2", const(q + "b0", np.array([0], np.int64)), const(q + "e0", np.array([1], np.int64)), const(q + "ax", np.array([3], np.int64))], [q + "y"], name=q + "y"),
            helper.make_node("Slice", [q + "c2", const(q + "b1", np.array([1], np.int64)), const(q + "e1", np.array([2], np.int64)), q + "ax"], [q + "x"], name=q + "x"),
            helper.make_node("Mul", [q + "x", const(q + "kx", np.array(2.0 / (Wp - 1), np.float32))], [q + "x1"], name=q + "x1"),
            helper.make_node("Sub", [q + "x1", const(q + "one", np.array(1.0, np.float32))], [q + "xn"], name=q + "xn"),
            helper.make_node("Mul", [q + "y", const(q + "ky", np.array(2.0 / (Hp - 1), np.float32))], [q + "y1"], name=q + "y1"),
            helper.make_node("Sub", [q + "y1", q + "one"], [q + "yn"], name=q + "yn"),
            helper.make_node("Concat", [q + "xn", q + "yn"], [q + "grid"], axis=3, name=q + "grid"),
            helper.make_node("GridSample", [pad_out, q + "grid"], [q + "sampled"], mode="bilinear",
                             padding_mode="zeros", align_corners=1, name=q + "sampled"),
            helper.make_node("Reshape", [mask, const(q + "s2", np.array([1, 1, kh, kw, H, W], np.int64))], [q + "m0"], name=q + "m0"),
            helper.make_node("Transpose", [q + "m0"], [q + "m1"], perm=[0, 1, 4, 2, 5, 3], name=q + "m1"),
            helper.make_node("Reshape", [q + "m1", const(q + "s3", np.array([1, 1, H * kh, W * kw], np.int64))], [q + "m2"], name=q + "m2"),
            helper.make_node("Mul", [q + "sampled", q + "m2"], [q + "out"], name=q + "out"),
        ]
        consumer = [n for n in g.node if tiled in n.input]
        assert len(consumer) == 1, (p, len(consumer))
        insert_before[consumer[0].name] = nodes
        rename[tiled] = q + "out"

    out_nodes = []
    for n in g.node:
        if n.name in insert_before:
            out_nodes.extend(insert_before[n.name])
        for i, name in enumerate(n.input):
            if name in rename:
                n.input[i] = rename[name]
        out_nodes.append(n)

    # dead code: anything whose outputs nobody reads any more
    needed = {o.name for o in g.output}
    keep = []
    for n in reversed(out_nodes):
        if any(o in needed for o in n.output):
            keep.append(n)
            needed.update(i for i in n.input if i)
    keep.reverse()
    del g.node[:]
    g.node.extend(keep)
    g.initializer.extend(new_inits)
    used = {i for n in g.node for i in n.input}
    live = [t for t in g.initializer if t.name in used]
    del g.initializer[:]
    g.initializer.extend(live)
    onnx.save(m, dst)
    return len(blocks)
