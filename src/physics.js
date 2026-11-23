// physics.js — box world for a small cat (shell version, working; the CORE agent may improve it but must keep the API).
// Everything solid is an axis-aligned box. The cat is an upright cylinder (radius, height) moved axis by axis in sub-steps,
// with a small step-up so kerbs and thresholds do not stop it.
import * as THREE from 'three';

export async function create(G) {
  const boxes = [];
  const api = {
    boxes,
    addBox(b) { const box = { min: b.min.clone ? b.min.clone() : new THREE.Vector3(...b.min), max: b.max.clone ? b.max.clone() : new THREE.Vector3(...b.max), surface: b.surface || 'stone', oneWay: !!b.oneWay }; boxes.push(box); return box; },
    removeBox(box) { const i = boxes.indexOf(box); if (i >= 0) boxes.splice(i, 1); },
    build() {},
    // highest box top at or below yFrom under the point (x, z); 0 if none
    groundHeight(x, z, yFrom = 1e9, r = 0) {
      let y = 0, s = 'stone';
      for (const b of boxes) if (x >= b.min.x - r && x <= b.max.x + r && z >= b.min.z - r && z <= b.max.z + r && b.max.y <= yFrom + 1e-4 && b.max.y > y) { y = b.max.y; s = b.surface; }
      api._lastSurface = s; return y;
    },
    shelterAt(x, y, z) { for (const b of boxes) if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.min.y > y + 0.05 && b.min.y < y + 12) return true; return false; },
    raycast(o, d, maxDist = 100) {
      let best = null;
      for (const b of boxes) {
        let t0 = 0, t1 = maxDist, nAxis = -1, nSign = 0, ok = true;
        for (let a = 0; a < 3; a++) {
          const oa = o.getComponent(a), da = d.getComponent(a), mn = b.min.getComponent(a), mx = b.max.getComponent(a);
          if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) { ok = false; break; } continue; }
          let ta = (mn - oa) / da, tb = (mx - oa) / da, sgn = -1; if (ta > tb) { const t = ta; ta = tb; tb = t; sgn = 1; }
          if (ta > t0) { t0 = ta; nAxis = a; nSign = sgn; } if (tb < t1) t1 = tb; if (t0 > t1) { ok = false; break; }
        }
        if (ok && nAxis >= 0 && (!best || t0 < best.dist)) { const n = new THREE.Vector3(); n.setComponent(nAxis, nSign); best = { dist: t0, point: o.clone().addScaledVector(d, t0), normal: n, box: b }; }
      }
      return best;
    },
    // move a cylinder: pos is the feet position (mutated), vel is mutated; returns { onGround, surface, hitWall }
    moveBody(pos, vel, radius, height, dt) {
      const STEP = 0.14; let hitWall = false, onGround = false, surface = 'stone';
      const overlaps = (b, x, y, z) => x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z && y + height > b.min.y + 1e-4 && y < b.max.y - 1e-4;
      const n = Math.max(1, Math.ceil((Math.hypot(vel.x, vel.z) * dt) / (radius * 0.6)));
      for (let i = 0; i < n; i++) {
        for (const ax of ['x', 'z']) {
          const d = (vel[ax] * dt) / n; if (!d) continue;
          const nx = ax === 'x' ? pos.x + d : pos.x, nz = ax === 'z' ? pos.z + d : pos.z; let blocked = false;
          for (const b of boxes) {
            if (b.oneWay && pos.y < b.max.y - 1e-3) continue;
            if (!overlaps(b, nx, pos.y, nz)) continue;
            const up = b.max.y - pos.y;
            if (up > 0 && up <= STEP && vel.y <= 0.5) { let free = true; for (const c of boxes) if (c !== b && overlaps(c, nx, b.max.y + 1e-3, nz)) { free = false; break; } if (free) { pos.y = b.max.y; continue; } }
            blocked = true; break;
          }
          if (blocked) { vel[ax] = 0; hitWall = true; } else if (ax === 'x') pos.x = nx; else pos.z = nz;
        }
      }
      // vertical
      const dy = vel.y * dt; let ny = pos.y + dy;
      if (dy <= 0) {
        let top = 0, s = 'stone';
        for (const b of boxes) if (pos.x + radius * 0.7 > b.min.x && pos.x - radius * 0.7 < b.max.x && pos.z + radius * 0.7 > b.min.z && pos.z - radius * 0.7 < b.max.z && b.max.y <= pos.y + 1e-3 && b.max.y > top) { top = b.max.y; s = b.surface; }
        if (ny <= top) { ny = top; vel.y = 0; onGround = true; surface = s; }
      } else {
        for (const b of boxes) { if (b.oneWay) continue; if (pos.x + radius > b.min.x && pos.x - radius < b.max.x && pos.z + radius > b.min.z && pos.z - radius < b.max.z && pos.y + height <= b.min.y + 1e-3 && ny + height > b.min.y) { ny = b.min.y - height; vel.y = 0; } }
      }
      pos.y = ny;
      return { onGround, surface, hitWall };
    },
  };
  return api;
}

export async function showcase(G) {
  const T = G.THREE, mat = G.mats.get('concrete');
  const add = (x0, y0, z0, x1, y1, z1) => { G.physics.addBox({ min: new T.Vector3(x0, y0, z0), max: new T.Vector3(x1, y1, z1) }); const m = new T.Mesh(new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); G.scene.add(m); };
  add(-2, 0, -1, -1, 0.5, 0); add(0, 0, -1, 1, 1.0, 0); add(2, 0, -1, 3.5, 1.6, 0);
  return { cam: [0.5, 1.6, 6], target: [0.5, 0.6, 0], update() {} };
}
