import { useMemo, useState } from "react";
import "./App.css";

const W = 760;
const H = 560;
const P = 56;
const xMin = -1;
const xMax = 1;
const yMin = -4;
const yMax = 4;

const sampleBands = [
  { id: "small", label: "30〜50", min: 30, max: 50 },
  { id: "large", label: "180〜220", min: 180, max: 220 },
];

const noiseBands = [
  { id: "low", label: "4〜6%", min: 0.04, max: 0.06 },
  { id: "high", label: "12〜15%", min: 0.12, max: 0.15 },
];

function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed, salt) {
  let x = (seed >>> 0) ^ Math.imul((salt + 0x9e3779b9) >>> 0, 0x85ebca6b);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function randBetween(rng, min, max) {
  return min + rng() * (max - min);
}

function randSign(rng) {
  return rng() < 0.5 ? -1 : 1;
}

function randNormal(rng) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += rng();
  return sum - 6;
}


function normalizeSeedText(text) {
  return String(text).replace(/\D/g, "").slice(0, 6);
}

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) < 0.005) return "0";
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

function signed(value, digits = 2) {
  return value >= 0 ? `+ ${fmt(value, digits)}` : `− ${fmt(Math.abs(value), digits)}`;
}

function linearFormula(slope, intercept) {
  return `${fmt(slope)}x ${signed(intercept)}`;
}

function intervalFormula(left, right, isLast) {
  return `${fmt(left)} ≤ x ${isLast ? "≤" : "<"} ${fmt(right)}`;
}

function makeBreakpoints(rng, interiorCount) {
  const xs = [-1];
  const step = 2 / (interiorCount + 1);
  for (let i = 1; i <= interiorCount; i += 1) {
    const base = -1 + step * i;
    const jitter = (rng() - 0.5) * step * 0.58;
    xs.push(Math.max(-0.92, Math.min(0.92, base + jitter)));
  }
  xs.push(1);
  xs.sort((a, b) => a - b);
  return xs;
}

function chebyshevValues(x, degree) {
  const values = new Array(degree + 1).fill(0);
  values[0] = 1;
  if (degree >= 1) values[1] = x;
  for (let k = 2; k <= degree; k += 1) values[k] = 2 * x * values[k - 1] - values[k - 2];
  return values;
}

function predictChebyshev(coeffs, x) {
  const values = chebyshevValues(x, coeffs.length - 1);
  let y = 0;
  for (let k = 0; k < coeffs.length; k += 1) y += coeffs[k] * values[k];
  return y;
}

function interpolate(knots, x) {
  if (x <= knots[0].x) return knots[0].y;
  if (x >= knots[knots.length - 1].x) return knots[knots.length - 1].y;
  for (let i = 0; i < knots.length - 1; i += 1) {
    const a = knots[i];
    const b = knots[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.y * (1 - t) + b.y * t;
    }
  }
  return 0;
}

function makeSmoothRaw(rng) {
  const coeffs = [];
  const maxDeg = 10 + Math.floor(rng() * 4);
  for (let k = 0; k <= maxDeg; k += 1) {
    const decay = 1 / (1 + 0.2 * k * k);
    coeffs.push(randSign(rng) * randBetween(rng, 0.18, 1.15) * decay);
  }
  coeffs[0] *= 0.35;
  coeffs[1] *= 0.45;

  const bumps = [];
  const bumpCount = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < bumpCount; i += 1) {
    bumps.push({
      amp: randSign(rng) * randBetween(rng, 0.2, 0.62),
      center: randBetween(rng, -0.78, 0.78),
      width: randBetween(rng, 0.1, 0.24),
    });
  }

  const chebTerms = coeffs.map((c, k) => `${fmt(c)}T${k}(x)`).join(" ");
  const bumpTerms = bumps
    .map((b) => `${signed(b.amp)} exp(-0.5((x ${signed(-b.center)})/${fmt(b.width)})²)`)
    .join(" ");

  return {
    label: "滑らか非線形",
    expression: `g(x) = ${chebTerms}${bumpTerms}`,
    raw: (x) => {
      let y = predictChebyshev(coeffs, x);
      for (const b of bumps) {
        const z = (x - b.center) / b.width;
        y += b.amp * Math.exp(-0.5 * z * z);
      }
      return y;
    },
  };
}

function makePiecewiseRaw(rng, withWave = false) {
  const interiorCount = 3 + Math.floor(rng() * 2); // 4〜5区間
  const xs = makeBreakpoints(rng, interiorCount);
  const segments = [];
  const knots = [];
  let y = randBetween(rng, -0.7, 0.7);
  knots.push({ x: xs[0], y });

  for (let i = 0; i < xs.length - 1; i += 1) {
    const left = xs[i];
    const right = xs[i + 1];
    const sign = i % 2 === 0 ? randSign(rng) : -Math.sign(segments[i - 1].slope || 1);
    const slope = sign * randBetween(rng, 1.05, 3.15);
    const intercept = y - slope * left;
    segments.push({ left, right, slope, intercept });
    y = slope * right + intercept;
    knots.push({ x: right, y });
  }

  const waves = [];
  if (withWave) {
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i += 1) {
      waves.push({
        amp: randSign(rng) * randBetween(rng, 0.13, 0.32),
        freq: randBetween(rng, 1.25, 2.7),
        phase: randBetween(rng, 0, Math.PI * 2),
      });
    }
  }

  const segmentText = segments
    .map((s, i) => `${linearFormula(s.slope, s.intercept)}  (${intervalFormula(s.left, s.right, i === segments.length - 1)})`)
    .join("\n");
  const waveText = waves.length
    ? `\n+ ${waves.map((w) => `${fmt(w.amp)}sin(π·${fmt(w.freq)}x ${signed(w.phase)})`).join(" ")}`
    : "";

  return {
    label: withWave ? "区分的線形＋ゆらぎ" : "区分的線形風",
    expression: `g(x) =\n${segmentText}${waveText}`,
    raw: (x) => {
      let yValue = interpolate(knots, x);
      for (const w of waves) yValue += w.amp * Math.sin(Math.PI * w.freq * x + w.phase);
      return yValue;
    },
  };
}

function makeDiscontinuousPiecewiseRaw(rng) {
  const interiorCount = 3 + Math.floor(rng() * 2); // 4〜5区間
  const xs = makeBreakpoints(rng, interiorCount);
  const segments = [];
  let level = randBetween(rng, -0.9, 0.9);
  let previousSlope = 0;

  for (let i = 0; i < xs.length - 1; i += 1) {
    const left = xs[i];
    const right = xs[i + 1];
    const mid = (left + right) / 2;
    const sign = i === 0 ? randSign(rng) : -Math.sign(previousSlope || 1);
    const slope = sign * randBetween(rng, 1.15, 3.35);
    if (i > 0) level += randSign(rng) * randBetween(rng, 0.55, 1.45);
    const intercept = level - slope * mid;
    segments.push({ left, right, slope, intercept });
    previousSlope = slope;
  }

  function raw(x) {
    const last = segments[segments.length - 1];
    const s = segments.find((seg) => x >= seg.left && x < seg.right) || last;
    return s.slope * x + s.intercept;
  }

  const segmentText = segments
    .map((s, i) => `${linearFormula(s.slope, s.intercept)}  (${intervalFormula(s.left, s.right, i === segments.length - 1)})`)
    .join("\n");

  return {
    label: "非連続な区分的線形",
    expression: `g(x) =\n${segmentText}`,
    discontinuous: true,
    segments,
    raw,
  };
}

function normalizeFunction(spec) {
  const xs = Array.from({ length: 801 }, (_, i) => xMin + (i / 800) * (xMax - xMin));
  const ys = xs.map(spec.raw);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const center = (minY + maxY) / 2;
  const range = Math.max(maxY - minY, 1e-6);
  const targetRange = 4.8;
  const scale = targetRange / range;
  const normalizedExpression = `f(x) = ${fmt(scale, 3)} × ( g(x) ${signed(-center, 3)} )\n${spec.expression}`;

  return {
    label: spec.label,
    expression: normalizedExpression,
    discontinuous: Boolean(spec.discontinuous),
    segments: spec.segments
      ? spec.segments.map((s) => ({
          left: s.left,
          right: s.right,
          f: (x) => (s.slope * x + s.intercept - center) * scale,
        }))
      : null,
    f: (x) => (spec.raw(x) - center) * scale,
  };
}

function generateTrueFunction(seed) {
  const rng = mulberry32(hashSeed(seed, 101));
  const typeRoll = rng();
  let spec;
  if (typeRoll < 0.3) spec = makePiecewiseRaw(rng, false);
  else if (typeRoll < 0.56) spec = makeDiscontinuousPiecewiseRaw(rng);
  else if (typeRoll < 0.76) spec = makePiecewiseRaw(rng, true);
  else spec = makeSmoothRaw(rng);
  return normalizeFunction(spec);
}

function shuffleInPlace(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function generateProblem(seed) {
  const rngMeta = mulberry32(hashSeed(seed, 202));
  const sampleBand = sampleBands[Math.floor(rngMeta() * sampleBands.length)];
  const noiseBand = noiseBands[Math.floor(rngMeta() * noiseBands.length)];
  const sampleSize = sampleBand.min + Math.floor(rngMeta() * (sampleBand.max - sampleBand.min + 1));
  const noiseRatio = randBetween(rngMeta, noiseBand.min, noiseBand.max);
  const trueFn = generateTrueFunction(seed);

  const grid = Array.from({ length: 801 }, (_, i) => xMin + (i / 800) * (xMax - xMin));
  const trueYs = grid.map(trueFn.f);
  const yRange = Math.max(...trueYs) - Math.min(...trueYs);
  const noiseStd = yRange * noiseRatio;

  const rngData = mulberry32(hashSeed(seed, 303));
  const data = [];
  for (let i = 0; i < sampleSize; i += 1) {
    const x = randBetween(rngData, xMin, xMax);
    const yTrue = trueFn.f(x);
    const y = yTrue + noiseStd * randNormal(rngData);
    data.push({ x, y, yTrue, split: "train" });
  }

  const rngSplit = mulberry32(hashSeed(seed, 404));
  shuffleInPlace(data, rngSplit);
  const trainCount = Math.round(sampleSize * 0.75);
  const train = data.slice(0, trainCount).map((p) => ({ ...p, split: "train" })).sort((a, b) => a.x - b.x);
  const test = data.slice(trainCount).map((p) => ({ ...p, split: "test" })).sort((a, b) => a.x - b.x);

  return {
    seed,
    sampleBand: sampleBand.id,
    sampleBandLabel: sampleBand.label,
    noiseBand: noiseBand.id,
    noiseBandLabel: noiseBand.label,
    trueFn,
    sampleSize,
    trainCount,
    testCount: test.length,
    noiseRatio,
    noiseStd,
    yRange,
    train,
    test,
    all: train.concat(test),
  };
}

function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.slice().concat(b[i]));

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-12) return null;
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivot = M[col][col];
    for (let j = col; j <= n; j += 1) M[col][j] /= pivot;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = M[row][col];
      if (Math.abs(factor) < 1e-18) continue;
      for (let j = col; j <= n; j += 1) M[row][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

function leastSquaresChebyshev(data, degree) {
  const size = degree + 1;
  const A = Array.from({ length: size }, () => Array(size).fill(0));
  const b = Array(size).fill(0);
  const ridge = 1e-10;

  for (const p of data) {
    const basis = chebyshevValues(p.x, degree);
    for (let i = 0; i < size; i += 1) {
      b[i] += basis[i] * p.y;
      for (let j = 0; j < size; j += 1) A[i][j] += basis[i] * basis[j];
    }
  }
  for (let i = 0; i < size; i += 1) A[i][i] += ridge;
  return solveLinearSystem(A, b);
}

function rmse(data, coeffs) {
  if (!data.length || !coeffs) return NaN;
  const mse = data.reduce((sum, p) => {
    const e = p.y - predictChebyshev(coeffs, p.x);
    return sum + e * e;
  }, 0) / data.length;
  return Math.sqrt(mse);
}

function xToSvg(x) {
  return P + ((x - xMin) / (xMax - xMin)) * (W - P * 2);
}

function yToSvg(y) {
  return H - P - ((y - yMin) / (yMax - yMin)) * (H - P * 2);
}

function pathFromFunction(fn, steps = 520, fromX = xMin, toX = xMax) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = fromX + (i / steps) * (toX - fromX);
    pts.push(`${xToSvg(x).toFixed(2)},${yToSvg(fn(x)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function AxisAndGrid() {
  const xGrid = [];
  for (let x = -1; x <= 1.0001; x += 0.25) xGrid.push(x);
  const yGrid = [];
  for (let y = -4; y <= 4.0001; y += 1) yGrid.push(y);
  const xTicks = [];
  for (let x = -1; x <= 1.0001; x += 0.5) if (Math.abs(x) > 1e-9) xTicks.push(x);
  const yTicks = [];
  for (let y = -4; y <= 4.0001; y += 2) if (Math.abs(y) > 1e-9) yTicks.push(y);

  return (
    <>
      <rect x={P} y={P} width={W - 2 * P} height={H - 2 * P} className="plot-frame" />
      {xGrid.map((x) => (
        <line key={`xg-${x}`} x1={xToSvg(x)} y1={yToSvg(yMin)} x2={xToSvg(x)} y2={yToSvg(yMax)} className="grid-line" />
      ))}
      {yGrid.map((y) => (
        <line key={`yg-${y}`} x1={xToSvg(xMin)} y1={yToSvg(y)} x2={xToSvg(xMax)} y2={yToSvg(y)} className="grid-line" />
      ))}
      <line x1={xToSvg(xMin)} y1={yToSvg(0)} x2={xToSvg(xMax)} y2={yToSvg(0)} className="axis" />
      <line x1={xToSvg(0)} y1={yToSvg(yMin)} x2={xToSvg(0)} y2={yToSvg(yMax)} className="axis" />
      {xTicks.map((x) => (
        <text key={`xt-${x}`} x={xToSvg(x)} y={yToSvg(0) + 20} textAnchor="middle" className="tick-label">
          {x.toFixed(1)}
        </text>
      ))}
      {yTicks.map((y) => (
        <text key={`yt-${y}`} x={xToSvg(0) - 12} y={yToSvg(y) + 4} textAnchor="end" className="tick-label">
          {y}
        </text>
      ))}
      <text x={xToSvg(xMax) + 17} y={yToSvg(0) + 5} className="axis-label">
        x
      </text>
      <text x={xToSvg(0) - 4} y={yToSvg(yMax) - 18} textAnchor="end" className="axis-label">
        y
      </text>
    </>
  );
}

function Stat({ label, value, className = "" }) {
  return (
    <div className={`stat ${className}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export default function App() {
  const [currentCode, setCurrentCode] = useState("314159");
  const [degree, setDegree] = useState(5);

  const normalizedCode = normalizeSeedText(currentCode);
  const isValidCode = /^\d{6}$/.test(normalizedCode);

  const current = useMemo(() => {
    if (!isValidCode) return null;
    return generateProblem(Number(normalizedCode));
  }, [isValidCode, normalizedCode]);

  const fit = useMemo(() => {
    if (!current) return null;
    const coeffs = leastSquaresChebyshev(current.train, degree);
    if (!coeffs) return null;
    return {
      coeffs,
      trainRmse: rmse(current.train, coeffs),
      testRmse: rmse(current.test, coeffs),
    };
  }, [current, degree]);

  const seedNote = !normalizedCode
    ? "6桁コードを入力してください。"
    : !isValidCode
      ? "6桁の数値を入力してください。"
      : current && !fit
        ? "計算が不安定になりました。別のコードまたは次数を試してください。"
        : "";

  const handleSeedChange = (event) => {
    setCurrentCode(normalizeSeedText(event.target.value));
  };

  return (
    <div className="page">
      <header>
        <div>
          <h1>多項式モデルの学習シミュレータ</h1>
        </div>
        <div className="legend" aria-label="凡例">
          <span className="legend-item">
            <span className="legend-line legend-fit" />学習した多項式モデル
          </span>
          <span className="legend-item">
            <span className="legend-dot legend-train" />学習データ
          </span>
          <span className="legend-item">
            <span className="legend-dot legend-test" />テストデータ
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="card plot-card">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="多項式モデルの当てはめグラフ">
            <AxisAndGrid />
            {current?.train.map((point, index) => (
              <circle key={`train-${index}`} cx={xToSvg(point.x)} cy={yToSvg(point.y)} r="4.1" className="train-point" />
            ))}
            {current?.test.map((point, index) => (
              <circle key={`test-${index}`} cx={xToSvg(point.x)} cy={yToSvg(point.y)} r="4.8" className="test-point" />
            ))}
            {fit?.coeffs && (
              <polyline points={pathFromFunction((x) => predictChebyshev(fit.coeffs, x))} className="fit-line" />
            )}
          </svg>
        </section>

        <aside className="side">
          <section className="card panel">
            <div className="field">
              <label htmlFor="seedInput">6桁コード</label>
              <input
                id="seedInput"
                type="text"
                inputMode="numeric"
                maxLength="6"
                pattern="[0-9]{6}"
                value={normalizedCode}
                onChange={handleSeedChange}
              />
              <div className="code-note">{seedNote}</div>
            </div>

            <div className="field">
              <label htmlFor="degreeRange">多項式モデルの次数M</label>
              <div className="row">
                <input
                  id="degreeRange"
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={degree}
                  onChange={(event) => setDegree(Number(event.target.value))}
                />
                <span className="degree-value">M={degree}</span>
              </div>
            </div>
          </section>

          <section className="card panel">
            <h2>結果</h2>
            <div className="stats">
              <Stat label="総データ数" value={current ? String(current.sampleSize) : "—"} className="blue" />
              <Stat label="学習データ数 / テストデータ数" value={current ? `${current.trainCount}/${current.testCount}` : "—"} />
              <Stat label="学習RMSE" value={fit ? fit.trainRmse.toFixed(3) : "—"} className="rose" />
              <Stat label="テストRMSE" value={fit ? fit.testRmse.toFixed(3) : "—"} className="rose" />
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
