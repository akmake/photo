"""Verify input-channel evidence from the original checkpoint and converted graph.

This checks the input contract only; it is not whole-network numerical parity.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import torch


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('checkpoint',type=Path)
    p.add_argument('onnx_model',type=Path)
    p.add_argument('--output',required=True,type=Path)
    a=p.parse_args()
    # Legacy checkpoint metadata contains a NumPy metric scalar. Permit only
    # these known scalar types; never enable general pickle execution.
    with torch.serialization.safe_globals([
        (np._core.multiarray.scalar,'numpy.core.multiarray.scalar'),
        np.dtype,type(np.dtype('float64'))]):
        checkpoint=torch.load(a.checkpoint,map_location='cpu',weights_only=True)
    config=ast.parse(checkpoint['meta']['config'])
    normalizer=next(n.value for n in config.body if isinstance(n,ast.Assign)
        and any(isinstance(t,ast.Name) and t.id=='img_norm_cfg' for t in n.targets))
    assert isinstance(normalizer,ast.Call) and isinstance(normalizer.func,ast.Name) and normalizer.func.id=='dict'
    normalization={k.arg:ast.literal_eval(k.value) for k in normalizer.keywords}
    assert normalization['to_rgb'] is True
    graph=onnx.load(a.onnx_model).graph
    first_consumers=[n for n in graph.node if 'image' in n.input]
    # Shape nodes read dimensions, not channel values. Only Conv may consume
    # input values directly; otherwise a channel transform needs inspection.
    value_consumers=[n for n in first_consumers if n.op_type!='Shape']
    assert len(value_consumers)==1 and value_consumers[0].op_type=='Conv'
    first=value_consumers[0]
    converted=onnx.numpy_helper.to_array(next(i for i in graph.initializer if i.name==first.input[1]))
    original=checkpoint['state_dict']['backbone.layers.0.0.projection.weight'].numpy()
    np.testing.assert_array_equal(original,converted)
    report={'checkpointSha256':hashlib.sha256(a.checkpoint.read_bytes()).hexdigest(),
        'onnxSha256':hashlib.sha256(a.onnx_model.read_bytes()).hexdigest(),
        'normalization':normalization,'firstConvWeightMaxDifference':0,
        'inputGoesDirectlyToFirstConv':True,'expectedInputOrder':'RGB',
        'classes':list(checkpoint['meta']['CLASSES']),'wholeNetworkParityVerified':False}
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
