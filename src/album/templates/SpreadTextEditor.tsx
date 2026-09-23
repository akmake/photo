import { useEffect, useRef } from 'react';
import { colorOf, textOf } from './library';
import type { AlbumTemplate, SpreadTemplateInstance, TextLayer } from './types';

/* A caret in the words themselves.
 *
 * Until now the way to change a title was a textarea in a side panel: the
 * photographer typed in one place and watched the letters appear in another.
 * This draws an editable copy of the text exactly where the text is — same
 * box, same font, same size, same colour — so typing looks like typing on the
 * spread. The printed layer underneath stands aside while this is open
 * (TemplateLayerView's hideLayerId), so there is only ever one line of letters.
 *
 * The contents are seeded once and read back on the way out. React must not
 * own the characters of a contentEditable: re-rendering it on every keystroke
 * puts the caret back at the start, which is worse than the panel it replaces.
 * So the toolbar above may restyle this freely — font, size, colour — and the
 * words stay where the photographer left them. */

const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;
const ALIGN_ITEMS = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

export default function SpreadTextEditor({ template, instance, layer, onCommit, onClose }: {
  template: AlbumTemplate;
  instance: SpreadTemplateInstance;
  layer: TextLayer;
  /** Called with the new words, on the way out and on Escape. */
  onCommit(text: string): void;
  onClose(): void;
}) {
  const box = useRef<HTMLDivElement>(null);

  /* Seed and select on arrival, once per text. Double-clicking a title and
   * typing replaces it, the way it does everywhere else. */
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    node.textContent = textOf(instance, layer);
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // seeding is per text, not per keystroke — see the note above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id]);

  const commit = () => {
    const text = (box.current?.innerText ?? '').replace(/ /g, ' ').replace(/\n+$/, '');
    onCommit(text);
  };

  return (
    <div className="tpl-text-editing-layer">
      <div
        ref={box}
        className="tpl-text tpl-text-editing"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="עריכת הטקסט"
        dir={layer.direction ?? 'rtl'}
        style={{
          left: `${layer.box.x * 100}%`,
          top: `${layer.box.y * 100}%`,
          width: `${layer.box.width * 100}%`,
          height: `${layer.box.height * 100}%`,
          color: layer.color ?? colorOf(template, instance, layer.colorToken),
          fontFamily: layer.fontFamily,
          fontWeight: layer.fontWeight,
          fontStyle: layer.italic ? 'italic' : 'normal',
          textDecoration: [layer.underline ? 'underline' : '', layer.strikeThrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
          letterSpacing: `${layer.letterSpacing ?? 0}em`,
          textTransform: layer.textTransform === 'none' ? undefined : layer.textTransform,
          textShadow: layer.effect === 'shadow'
            ? '0 .09em .16em rgba(0,0,0,.34)'
            : layer.effect === 'lift'
              ? '0 .16em .08em rgba(0,0,0,.2)'
              : undefined,
          WebkitTextStroke: layer.effect === 'outline' ? '.035em currentColor' : undefined,
          paintOrder: layer.effect === 'outline' ? 'stroke fill' : undefined,
          fontSize: `${layer.fontSize * 100}cqh`,
          lineHeight: layer.lineHeight,
          justifyContent: JUSTIFY[layer.align],
          alignItems: ALIGN_ITEMS[layer.verticalAlign],
          transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onBlur={() => { commit(); onClose(); }}
        onKeyDown={(event) => {
          // the spread's own shortcuts must not read what is being typed
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            commit();
            onClose();
          }
        }}
      />
    </div>
  );
}
