import type { GuideResult } from './smartGuides';

/* Draws the smart guides over the spread while a block moves or resizes:
 * magenta alignment lines, gap markers with their size (magenta when the gap
 * equals another one on the page, grey when it is only a measurement), the
 * block's size, and "equal width/height" badges. Nothing here is clickable. */

export default function SmartGuideOverlay({ guides }: { guides: GuideResult }) {
  const { box } = guides;
  return (
    <div className="sg-overlay" aria-hidden="true">
      <svg viewBox="0 0 1 1" preserveAspectRatio="none">
        {guides.lines.map((line, index) => (
          <line
            key={`l${index}`}
            x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
            className="sg-line"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {guides.gaps.map((gap, index) => (
          <line
            key={`g${index}`}
            x1={gap.x1} y1={gap.y1} x2={gap.x2} y2={gap.y2}
            className={gap.equal ? 'sg-gap equal' : 'sg-gap'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {guides.gaps.map((gap, index) => (
        <span
          key={`t${index}`}
          className={gap.equal ? 'sg-label equal' : 'sg-label'}
          style={{ left: `${((gap.x1 + gap.x2) / 2) * 100}%`, top: `${((gap.y1 + gap.y2) / 2) * 100}%` }}
        >
          {gap.label}
        </span>
      ))}
      <span
        className="sg-size"
        style={{ left: `${(box.x + box.width / 2) * 100}%`, top: `${(box.y + box.height) * 100}%` }}
      >
        {guides.size}
        {guides.badges.map((badge) => <b key={badge}>{badge}</b>)}
      </span>
    </div>
  );
}
