import { memo, useId } from "react";
import { bodyGeometry, type BodyProfile } from "./model";

export const BodyFigure = memo(function BodyFigure({
  profile,
  view,
}: {
  profile: BodyProfile;
  view: "front" | "back";
}) {
  const id = useId().replaceAll(":", ""),
    g = bodyGeometry(profile.measurements),
    m = profile.measurements;
  const skin = profile.material === "skin",
    back = view === "back";
  const colors = skin
    ? ["#86574f", "#cf9480", "#f6cbb0", "#d79c86", "#81544d"]
    : ["#0c1b36", "#24496e", "#628fae", "#2c547b", "#0c1a32"];
  const fill = (name: string) => `url(#${id}-${name})`;
  const height = 110 + (g.end - 110) * g.scale + 35;
  const surface = (d: string, key: string, mirror = false) => (
    <g key={key} transform={mirror ? "scale(-1 1)" : undefined}>
      <path
        d={d}
        fill={fill("volume")}
        stroke={skin ? "#855c57" : "#0e203a"}
        strokeWidth="1.4"
      />
      {!skin && <path d={d} fill={fill("mesh")} opacity=".38" />}
    </g>
  );
  return (
    <svg
      className="body-figure"
      viewBox={`${-g.width / 2} 0 ${g.width} ${height}`}
      role="img"
      aria-label={`${profile.name}, ${view} view, ${profile.material} material`}
      data-view={view}
    >
      <defs>
        <linearGradient id={`${id}-volume`} x1="0" x2="1">
          {colors.map((c, i) => (
            <stop key={i} offset={`${i * 25}%`} stopColor={c} />
          ))}
        </linearGradient>
        <radialGradient id={`${id}-round`} cx="38%" cy="26%" r="76%">
          <stop stopColor={colors[2]} />
          <stop offset=".55" stopColor={colors[3]} />
          <stop offset="1" stopColor={colors[0]} />
        </radialGradient>
        <linearGradient id={`${id}-face`} x1="0" x2="1">
          <stop stopColor="#bb8173" />
          <stop offset=".42" stopColor="#f6d3bc" />
          <stop offset=".75" stopColor="#edb99e" />
          <stop offset="1" stopColor="#ac7167" />
        </linearGradient>
        <linearGradient id={`${id}-hair`} x1="0" x2="1">
          <stop stopColor="#101d31" />
          <stop offset=".4" stopColor="#415b79" />
          <stop offset=".6" stopColor="#263b58" />
          <stop offset="1" stopColor="#101b30" />
        </linearGradient>
        <pattern
          id={`${id}-mesh`}
          width="14"
          height="20"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M0 0L14 20M14 0L0 20M0 10H14"
            fill="none"
            stroke="#a4d2f1"
            strokeWidth=".6"
          />
        </pattern>
        <clipPath id={`${id}-torso`}>
          <path d={g.torso} />
        </clipPath>
      </defs>
      <ellipse
        cx="0"
        cy={height - 19}
        rx={Math.min(140, g.hip + 48)}
        ry="9"
        fill="#030b19"
        opacity=".28"
      />
      <g transform={`translate(0 110) scale(1 ${g.scale}) translate(0 -110)`}>
        {surface(g.arm, "left-arm", true)}
        {surface(g.arm, "right-arm")}
        {surface(g.leg, "left-leg", true)}
        {surface(g.leg, "right-leg")}
        {surface(g.torso, "torso")}
        <g clipPath={fill("torso")}>
          {back ? (
            <>
              <path
                d={`M ${-g.shoulder + 12} 148 Q -18 172 -9 215 M ${g.shoulder - 12} 148 Q 18 172 9 215`}
                fill="none"
                stroke={colors[0]}
                strokeWidth="2"
                opacity=".35"
              />
              <path
                d="M0 139 Q -4 200 0 270"
                fill="none"
                stroke={colors[0]}
                strokeWidth="2"
                opacity=".28"
              />
              {[-1, 1].map((s) => (
                <ellipse
                  key={s}
                  cx={s * g.hip * 0.43}
                  cy="315"
                  rx={g.hip * 0.53}
                  ry="43"
                  fill={fill("round")}
                  opacity=".82"
                />
              ))}
            </>
          ) : (
            <>
              <path
                d={`M -16 136 Q -28 146 ${-g.shoulder + 9} 145 M 16 136 Q 28 146 ${g.shoulder - 9} 145`}
                fill="none"
                stroke={colors[0]}
                strokeWidth="2"
                opacity=".42"
              />
              {[-1, 1].map((s) => (
                <path
                  key={s}
                  d={`M ${s * 5} 164 C ${s * 25} 148 ${s * (g.chest - 8)} 151 ${s * (g.chest - 3)} 180 C ${s * (g.chest + 3)} ${195 + 15 * m.chest} ${s * 16} ${204 + 14 * m.chest} ${s * 5} 181 Z`}
                  fill={fill("round")}
                  opacity=".82"
                />
              ))}
              <path
                d={`M -9 220 Q ${-g.waist * 0.2} 247 -8 272 M 9 220 Q ${g.waist * 0.2} 247 8 272`}
                fill="none"
                stroke={colors[2]}
                strokeWidth="2.5"
                opacity=".24"
              />
              <path
                d="M-2 270 Q0 274 2 270"
                fill="none"
                stroke={colors[0]}
                strokeWidth="1.5"
                opacity=".5"
              />
            </>
          )}
          {!skin && <path d={g.torso} fill={fill("mesh")} opacity=".2" />}
        </g>
        {[-1, 1].map((s) => (
          <g key={s} transform={`scale(${s} 1)`} fill="none">
            <path
              d={`M ${g.legX - 8} 375 Q ${g.legX - 13} ${g.knee - 30} ${g.legX - 5} ${g.knee - 7}`}
              stroke={colors[2]}
              strokeWidth="3"
              opacity=".32"
            />
            <path
              d={`M ${g.legX - 7} ${g.knee + 27} Q ${g.legX - 6} ${g.ankle - 35} ${g.legX - 4} ${g.ankle - 12}`}
              stroke={colors[2]}
              strokeWidth="2"
              opacity=".35"
            />
          </g>
        ))}
      </g>
      <path
        d="M-33 59 Q-38 23 0 22 Q40 22 34 69 L39 124 Q18 139 0 126 Q-21 139 -39 124 Z"
        fill={fill("hair")}
        stroke="#15253c"
        strokeWidth="1.5"
      />
      {!back && (
        <>
          <path
            d="M-28 59 Q-30 83 -21 98 Q-10 111 0 116 Q11 111 23 97 Q31 81 28 59 Z"
            fill={fill("face")}
            stroke="#a3746b"
            strokeWidth="1"
          />
          {[-1, 1].map((s) => (
            <g key={s} transform={`scale(${s} 1)`}>
              <path d="M6 78 Q16 70 25 78 Q18 88 8 83Z" fill="#eef3fa" />
              <path
                d="M6 78 Q16 70 25 78"
                fill="none"
                stroke="#283143"
                strokeWidth="2"
              />
              <ellipse cx="16" cy="79" rx="4" ry="5" fill="#53788c" />
              <ellipse cx="16" cy="79" rx="2" ry="4" fill="#192c43" />
              <circle cx="15" cy="77" r="1.3" fill="white" />
              <path
                d="M7 67 Q17 64 25 69"
                fill="none"
                stroke="#4c3b40"
                strokeWidth="1.4"
              />
            </g>
          ))}
          <path
            d="M1 83 L-1 92 L2 93 M-5 101 Q0 103 5 101"
            fill="none"
            stroke="#a97169"
            strokeWidth="1.2"
          />
          <path
            d="M-32 66 Q-36 23 0 24 Q35 21 34 67 L21 75 L24 48 Q15 66 7 69 L9 48 Q-1 66 -10 70 L-6 48 Q-19 68 -31 77Z"
            fill={fill("hair")}
          />
        </>
      )}
      <path
        d={
          back
            ? "M-19 40 Q-28 73 -23 118 M-9 34 Q-17 73 -11 124 M10 33 Q22 80 18 121"
            : "M-20 37 Q-9 27 2 30 M10 31 Q27 37 28 51"
        }
        fill="none"
        stroke="#86a8c6"
        strokeWidth="1.5"
        opacity=".35"
      />
    </svg>
  );
});
