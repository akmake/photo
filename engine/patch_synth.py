"""Guided patch synthesis: the network decides WHAT, the photograph decides HOW.

WHY. LaMa (lama_fill.py) knows what belongs in a hole — where the path runs,
where the light falls — but a large hole has to be run at reduced size, and
what comes back is soft. The old answer borrowed detail back from nearby
(lama_fill._regrain), matched on colour blurred 8x the reduction. At that blur
a smooth background and a horse's mane look alike, and the borrowing brought
mane hair into a soft background (a ghost of the removed man, drawn in hair),
knitting from a child's sweater onto a blurred wagon rail. And where the
network returned a dark average — a person removed from a wall of bougainvillea
— there was nothing for the borrowing to restore: a dark smeared hole.

WHAT. The published answer to exactly this is SuperCAF (Zhang et al., Adobe,
ECCV 2022): run the network at 512, then rebuild the hole at full size purely
out of the photograph's own patches, with the patch search steered mainly by a
STRUCTURE image — an edge-preserving smoothing of the network-filled picture,
weighted 0.7 against 0.3 for colour. Every pixel of the result is a real pixel
of this photo, so sharpness, grain and texture are its own; the structure
guide keeps the network's lines. Their code is non-commercial; this is written
from the paper.

HOW IT DIFFERS FROM THE PAPER.
  - The search starts from an approximate nearest-neighbour kd-tree over
    reduced patch features (Wexler, Shechtman & Irani 2007) and is refined by
    PatchMatch (Barnes et al. 2009): jump propagation from neighbours and a
    shrinking random search. PatchMatch is covered by Adobe's US 8,285,055
    (to 2031-04-09), with no family member found outside the US; the product
    is sold in Israel only — the photographer's decision, 2026-09-24.
  - A texture-energy term: each source patch's full-size detail energy must
    match what the hole's surroundings carry. Measured at FULL size and averaged
    down, because at 1/8 size a knitted sweater and a blurred background look
    alike; their grain does not.
  - Search stops at the level where the hole spans WORK_HOLE px; finer levels
    carry the correspondence up and re-search only what no longer fits.
  - The final vote barely averages (FINAL_SHARP): averaging several sources is
    exactly what softens a fill; pure winner-take-all instead switched source
    pixel by pixel and doubled the grain (1.5-1.9x the truth). Measured on 16
    ropes and stones against the real background: 0.05 -> grain 1.14x.
"""

import cv2
import numpy as np

R = 3                 # patch radius: 7x7
COARSE_MAX = 160      # the coarsest level is at most this wide
WORK_HOLE = 360       # search up to the level where the hole spans this many px...
WORK_AREA = 130000    # ...unless the hole is this small in pixels there (a rope: search at full size)
STRUCT_WEIGHT = 0.7   # SuperCAF's structure/colour split
TEX_WEIGHT = 15.0     # texture features (Newson et al. 2017: 50 against colour weight 1)
TEX_WINDOW = 9        # px at full size over which |dI/dx|, |dI/dy| are averaged
FINAL_SHARP = 0.0     # 0 = each pixel from its best patch (Newson's final step)
MID_SHARP = 1.0
DIMS = 28             # patch features after reduction
MAX_SOURCES = 220000  # kd-tree size cap
#: Above this many hole pixels at the full-size level, the correspondence
#: carried up from the half-size level is used as it comes (no pixel-level
#: polishing): a standing man, 1.6M pixels, spent 25s of 52 there.
LIGHT_PX = 500000
#: PatchMatch's random search. Implemented and measured on 80 removals
#: (2026-09-24): the same result in every category (32/40, 30/40 on the set
#: never tuned on), 65% more time — the kd-tree start and the propagation
#: already find those patches. Off; kept for the day a case needs it.
RANDOM_SEARCH = False


def _membrane(v, known):
    """Smooth interpolation of v from the known pixels into the rest."""
    k = known.astype(np.float32)
    if min(v.shape) < 4:
        return np.full(v.shape, float((v * k).sum() / max(k.sum(), 1e-6)), np.float32)
    num, den = cv2.pyrDown(v * k), cv2.pyrDown(k)
    ck = den > 1e-3
    coarse = np.where(ck, num / np.maximum(den, 1e-6), 0).astype(np.float32)
    up = cv2.pyrUp(_membrane(coarse, ck), dstsize=(v.shape[1], v.shape[0]))
    return np.where(known, v, up).astype(np.float32)


def _pyr(img, n):
    out = [img]
    for _ in range(n):
        out.append(cv2.resize(out[-1], ((out[-1].shape[1] + 1) // 2, (out[-1].shape[0] + 1) // 2),
                              interpolation=cv2.INTER_AREA))
    return out


def _mask_pyr(m, n):
    out = [m]
    for _ in range(n):
        s = cv2.resize(out[-1].astype(np.float32), ((out[-1].shape[1] + 1) // 2, (out[-1].shape[0] + 1) // 2),
                       interpolation=cv2.INTER_AREA)
        out.append((s > 0.01).astype(np.uint8))   # any trace of hole is hole
    return out


def structure(img: np.ndarray) -> np.ndarray:
    """Large edges kept, small-scale texture gone (rolling guidance filter)."""
    return cv2.ximgproc.rollingGuidanceFilter(img, d=-1, sigmaColor=25.0, sigmaSpace=4.0, numOfIter=4)


class _Level:
    """One pyramid level: the correspondence hole-patch -> source-patch."""

    def __init__(self, img, hole, avoid, struct, tex, rng, sample):
        p = R
        self.h, self.w = hole.shape
        self.W = self.w + 2 * p
        self.img = np.pad(img.astype(np.float32), ((p, p), (p, p), (0, 0)), mode="reflect")
        self.hole = np.pad(hole, p, mode="constant")
        k = np.ones((2 * p + 1, 2 * p + 1), np.uint8)
        inner = np.zeros_like(self.hole); inner[p:-p, p:-p] = 1
        known = ((self.hole == 0) & (np.pad(avoid, p, mode="constant") == 0)).astype(np.uint8)
        # a source patch must lie wholly in known photograph
        self.valid = cv2.erode(known * inner, k) > 0
        self.valid[:p] = self.valid[-p:] = False
        self.valid[:, :p] = self.valid[:, -p:] = False
        # every patch that touches the hole takes part
        cent = (cv2.dilate(self.hole, k) > 0) & (inner > 0)
        self.cy, self.cx = np.nonzero(cent)
        self.cidx = np.full(self.hole.shape, -1, np.int64)
        self.cidx[self.cy, self.cx] = np.arange(len(self.cy))
        self.vy, self.vx = np.nonzero(self.valid)
        self.gs = np.pad(struct.astype(np.float32), ((p, p), (p, p), (0, 0)), mode="reflect").reshape(-1, 3)
        # texture features: the photo's own where known; inside the hole they
        # start as an interpolation and are then rebuilt WITH the colours, from
        # the same sources (Newson et al.: the averaging otherwise drifts the
        # hole toward smooth patches)
        tp = np.pad(tex.astype(np.float32), ((p, p), (p, p), (0, 0)), mode="reflect")
        self.XS = tp.reshape(-1, 2)
        self.XT = np.dstack([_membrane(tp[..., c], known > 0) for c in range(2)]).reshape(-1, 2)
        qs = [(dy, dx) for dy in range(-p, p + 1) for dx in range(-p, p + 1)]
        self.Q = qs[::sample]
        self.rng = rng
        self.S = self.img.reshape(-1, 3)
        self.T = self.S.copy()          # known pixels + the current estimate
        hy, hx = np.nonzero(self.hole)
        self.hy, self.hx = hy, hx
        self.hflat = hy * self.W + hx
        # colour, structure and texture side by side, pre-weighted, so a patch
        # distance is one read per patch pixel instead of three (the distance
        # was 72 of 115 seconds removing a standing man at full size)
        wc, ws, wt = np.sqrt(1 - STRUCT_WEIGHT), np.sqrt(STRUCT_WEIGHT), np.sqrt(TEX_WEIGHT)
        self._wc, self._wt = wc, wt
        self.FS = np.concatenate([self.S * wc, self.gs * ws, self.XS * wt], 1).astype(np.float32)
        self._sv = np.concatenate([self.S, self.XS], 1).astype(np.float32)   # what a vote copies
        self.FT = np.concatenate([self.T * wc, self.gs * ws, self.XT * wt], 1).astype(np.float32)

    def _refresh(self):
        """Carry the current estimate (colour and texture) into FT."""
        self.FT[self.hflat, :3] = self.T[self.hflat] * self._wc
        self.FT[self.hflat, 6:] = self.XT[self.hflat] * self._wt

    def set_estimate(self, est):
        e = np.pad(est.astype(np.float32), ((R, R), (R, R), (0, 0)), mode="reflect").reshape(-1, 3)
        self.T[self.hflat] = e[self.hflat]
        self._refresh()

    def dist(self, sy, sx, sel=None):
        cy, cx = (self.cy, self.cx) if sel is None else (self.cy[sel], self.cx[sel])
        tb, sb = cy * self.W + cx, sy * self.W + sx
        acc = np.zeros(len(cy), np.float32)
        for dy, dx in self.Q:
            o = dy * self.W + dx
            d = self.FT[tb + o] - self.FS[sb + o]
            acc += np.einsum("ij,ij->i", d, d)
        return acc * (49.0 / len(self.Q))

    def _feat(self, ys, xs, F):
        base = ys * self.W + xs
        return np.concatenate([F[base + dy * self.W + dx] for dy, dx in self.Q], axis=1)

    def build_tree(self):
        vy, vx = self.vy, self.vx
        if len(vy) > MAX_SOURCES:
            step = int(np.ceil(np.sqrt(len(vy) / MAX_SOURCES)))
            keep = (vy % step == 0) & (vx % step == 0)
            vy, vx = vy[keep], vx[keep]
        self.ty, self.tx = vy, vx
        F = self._feat(vy, vx, self.FS)
        sub = F[self.rng.choice(len(F), size=min(len(F), 20000), replace=False)]
        self.mean = sub.mean(0)
        _, _, vt = np.linalg.svd(sub - self.mean, full_matrices=False)
        self.basis = vt[:DIMS].T.copy()
        G = (F - self.mean) @ self.basis
        self.tree = cv2.flann_Index(np.ascontiguousarray(G, np.float32), dict(algorithm=1, trees=4))

    def query(self, sel=None):
        cy, cx = (self.cy, self.cx) if sel is None else (self.cy[sel], self.cx[sel])
        G = (self._feat(cy, cx, self.FT) - self.mean) @ self.basis
        idx, _ = self.tree.knnSearch(np.ascontiguousarray(G, np.float32), 1, params=dict(checks=24))
        return self.ty[idx[:, 0]], self.tx[idx[:, 0]]

    def offer(self, sy, sx, ok):
        """Take candidate sources where valid and better than the current."""
        sel = np.nonzero(ok)[0]
        sy, sx = sy[sel], sx[sel]
        v = self.valid[sy, sx]
        sel, sy, sx = sel[v], sy[v], sx[v]
        if not len(sel):
            return
        d = self.dist(sy, sx, sel)
        better = d < self.D[sel]
        b = sel[better]
        self.sy[b], self.sx[b], self.D[b] = sy[better], sx[better], d[better]

    def cohere(self, steps=(1,)):
        """Offer each patch its neighbour's source, shifted by the step: regions
        are copied as regions, not pixel by pixel from unrelated places (the
        kd-tree answers each patch alone). Steps 8,4,2,1 = PatchMatch's
        propagation in its parallel (jump) form."""
        H, Wd = self.hole.shape
        for k in steps:
            for dy, dx in ((0, k), (0, -k), (k, 0), (-k, 0)):
                ni = self.cidx[np.clip(self.cy + dy, 0, H - 1), np.clip(self.cx + dx, 0, Wd - 1)]
                ok = ni >= 0
                j = np.maximum(ni, 0)
                self.offer(np.clip(self.sy[j] - dy, 0, H - 1), np.clip(self.sx[j] - dx, 0, Wd - 1), ok)

    def random_search(self, sel=None):
        """PatchMatch's random search: around the current source, in windows
        halving from the whole level down to one pixel."""
        if not RANDOM_SEARCH:
            return
        H, Wd = self.hole.shape
        idx = np.arange(len(self.sy)) if sel is None else sel
        if not len(idx):
            return
        rad = max(H, Wd)
        while rad >= 1:
            sy, sx = self.sy.copy(), self.sx.copy()
            sy[idx] = np.clip(sy[idx] + self.rng.integers(-rad, rad + 1, len(idx)), 0, H - 1)
            sx[idx] = np.clip(sx[idx] + self.rng.integers(-rad, rad + 1, len(idx)), 0, Wd - 1)
            ok = np.zeros(len(sy), bool); ok[idx] = True
            self.offer(sy, sx, ok)
            rad //= 2

    def refine(self, cross=False):
        """Exhaustive check of every source one pixel around the current one
        (the four straight neighbours only, when `cross`)."""
        H, Wd = self.hole.shape
        every = np.ones(len(self.sy), bool)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if (dy or dx) and not (cross and dy and dx):
                    self.offer(np.clip(self.sy + dy, 0, H - 1), np.clip(self.sx + dx, 0, Wd - 1), every)

    def carry_up(self, lo):
        """The coarser level's correspondence, doubled."""
        H, Wd = self.hole.shape
        cy, cx = self.cy - R, self.cx - R
        li = lo.cidx[np.clip(cy // 2, 0, lo.h - 1) + R, np.clip(cx // 2, 0, lo.w - 1) + R]
        j = np.maximum(li, 0)
        sy = np.clip((lo.sy[j] - R) * 2 + (cy % 2) + R, 0, H - 1)
        sx = np.clip((lo.sx[j] - R) * 2 + (cx % 2) + R, 0, Wd - 1)
        bad = ~self.valid[sy, sx] | (li < 0)
        i = self.rng.integers(len(self.vy), size=int(bad.sum()))
        sy[bad], sx[bad] = self.vy[i], self.vx[i]
        self.sy, self.sx = sy, sx
        # rebuild the estimate from the sharp sources at THIS size before
        # judging anything by it (Newson et al.: upsample the map, not the image)
        self.D = np.zeros(len(sy), np.float32)
        self.vote(1.0)
        self.D = self.dist(sy, sx)

    def vote(self, sharp):
        """Each hole pixel from the patches covering it; texture features too.

        sharp > 0: weighted mean, weight exp(-distance / (sharp * p75)),
        clamped so that where every covering patch fits badly the pixel gets
        a plain mean (unclamped, the weights underflowed to zero and the
        division left black holes).
        sharp == 0: the pixel of the best patch covering it, no averaging -
        Newson et al.'s final step, sharp as the photo itself.
        """
        n = len(self.hflat)
        cflat = self.cidx.ravel()
        sflat = self.sy * self.W + self.sx
        SV = self._sv
        offs = [dy * self.W + dx for dy in range(-R, R + 1) for dx in range(-R, R + 1)]
        if sharp == 0:
            best = np.full(n, np.inf, np.float32)
            src_best = np.zeros(n, np.int64)
            for o in offs:
                ci = cflat[self.hflat - o]
                d = np.where(ci >= 0, self.D[np.maximum(ci, 0)], np.inf)
                ci = np.maximum(ci, 0)
                take = d < best
                src_best[take] = sflat[ci[take]] + o
                best[take] = d[take]
            got = SV[src_best]
        else:
            s2 = float(np.percentile(self.D, 75)) + 1e-3
            wcen = np.exp(-np.minimum(self.D / (sharp * s2), 60.0)).astype(np.float32)
            num = np.zeros((n, 5), np.float32)
            den = np.zeros(n, np.float32)
            for o in offs:
                ci = cflat[self.hflat - o]
                wv = np.where(ci >= 0, wcen[np.maximum(ci, 0)], 0).astype(np.float32)
                ci = np.maximum(ci, 0)
                num += wv[:, None] * SV[sflat[ci] + o]
                den += wv
            got = num / np.maximum(den, 1e-30)[:, None]
        vals, tex = got[:, :3], got[:, 3:]
        self.T[self.hflat] = vals
        self.XT[self.hflat] = tex
        self._refresh()
        out = self.img.copy()
        out[self.hy, self.hx] = vals
        return out[R:-R, R:-R]


def synthesize(win: np.ndarray, hole: np.ndarray, guide: np.ndarray, avoid: np.ndarray = None,
               seed: int = 0) -> np.ndarray:
    """win HxWx3 uint8, hole HxW (1 = rebuild), guide HxWx3 the network's answer.

    `avoid` marks photograph that is not to be copied (another object still to
    be removed).

    -> HxWx3 uint8; only hole pixels differ from `win`.
    """
    rng = np.random.default_rng(seed)
    n = 0
    while max(win.shape[:2]) / (2 ** n) > COARSE_MAX:
        n += 1
    ys, xs = np.nonzero(hole)
    span = max(ys.max() - ys.min(), xs.max() - xs.min()) + 1
    filled = win.copy()
    filled[hole > 0] = guide[hole > 0]
    # the structure is read where the network works (hole <= 512 px) and
    # carried to every level, so no level invents structure of its own
    wl = 0
    while span / (2 ** wl) > 512 and wl < n:
        wl += 1
    P, F, M = _pyr(win, n), _pyr(filled, n), _mask_pyr(hole.astype(np.uint8), n)
    A = _mask_pyr(np.zeros_like(hole, np.uint8) if avoid is None else avoid.astype(np.uint8), n)
    base = structure(F[wl]).astype(np.float32)
    St = [cv2.resize(base, (P[i].shape[1], P[i].shape[0]),
                     interpolation=cv2.INTER_AREA if i > wl else cv2.INTER_LINEAR) for i in range(n + 1)]
    # texture features at FULL size, averaged down: at 1/8 size a knitted
    # sweater and a blurred background look alike; their gradients do not
    gray = cv2.cvtColor(win, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=1))
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=1))
    E = _pyr(cv2.blur(np.dstack([gx, gy]), (TEX_WINDOW, TEX_WINDOW)), n)

    prev, est = None, None
    for li in range(n, -1, -1):
        cheap = span / (2 ** li) > WORK_HOLE and int(M[li].sum()) > WORK_AREA
        fine = li == 0
        L = _Level(P[li], M[li], A[li], St[li], E[li], rng, sample=3 if cheap else 1)
        L.set_estimate(F[li] if est is None else cv2.resize(est, (L.w, L.h), interpolation=cv2.INTER_LINEAR))
        if prev is not None:
            L.carry_up(prev)
        if cheap:
            # carry the correspondence up; re-search only what no longer fits
            if not (fine and len(L.hflat) > LIGHT_PX):
                L.cohere()
                L.refine(cross=True)
            bad = np.nonzero(L.D > 3.0 * float(np.percentile(L.D, 75)))[0]
            if len(bad):
                L.build_tree()
                sy, sx = L.query(bad)
                ok = np.zeros(len(L.sy), bool); ok[bad] = True
                fy, fx = L.sy.copy(), L.sx.copy()
                fy[bad], fx[bad] = sy, sx
                L.offer(fy, fx, ok)
                L.random_search(bad)
            est = L.vote(FINAL_SHARP if fine else MID_SHARP)
        else:
            L.build_tree()
            for it in range(5 if prev is None else 3):
                sy, sx = L.query()
                if prev is None and it == 0:
                    L.sy, L.sx = sy, sx
                    L.D = L.dist(sy, sx)
                else:
                    L.offer(sy, sx, np.ones(len(sy), bool))
                L.cohere((8, 4, 2, 1))
                L.random_search()
                L.refine()
                est = L.vote(FINAL_SHARP if fine else MID_SHARP)
                L.D = L.dist(L.sy, L.sx)
        prev = L
    return np.clip(np.rint(est), 0, 255).astype(np.uint8)
