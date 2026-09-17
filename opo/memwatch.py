"""Samples free physical memory every second until killed. One CSV line each.
   python memwatch.py <out.csv>
Deliberately trivial: it must not be the thing that slows the machine down."""
import ctypes
import sys
import time


class M(ctypes.Structure):
    _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong),
                ('ullTotalPhys', ctypes.c_ulonglong), ('ullAvailPhys', ctypes.c_ulonglong),
                ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong),
                ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]


with open(sys.argv[1], "w", encoding="utf-8") as fh:
    fh.write("t,free_gb,load_pct\n")
    while True:
        m = M()
        m.dwLength = ctypes.sizeof(m)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        fh.write(f"{time.time():.0f},{m.ullAvailPhys / 2**30:.2f},{m.dwMemoryLoad}\n")
        fh.flush()
        time.sleep(1)
