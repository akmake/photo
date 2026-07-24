import { useState } from 'react';
import type { Recipe } from '../types';
import { listStyles, saveStyle, deleteStyle } from '../styles';
import type { Style } from '../styles';
import { cloneRecipe } from '../toolRegistry';

interface Props {
  recipe: Recipe;
  onApply: (r: Recipe) => void;
}

export default function StyleBar({ recipe, onApply }: Props) {
  const [styles, setStyles] = useState<Style[]>(() => listStyles());
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  function save() {
    const n = name.trim();
    if (!n) return;
    setStyles(saveStyle(n, recipe));
    setName('');
    setNaming(false);
  }

  return (
    <div className="style-bar">
      <div className="style-bar-head">
        <span>הסגנונות שלי</span>
        <button className="ghost tiny" onClick={() => setNaming((v) => !v)}>
          {naming ? 'ביטול' : '+ שמור'}
        </button>
      </div>

      {naming && (
        <div className="style-new">
          <input
            autoFocus
            value={name}
            placeholder="שם הסגנון — למשל: לוק ים"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
          <button className="primary tiny" onClick={save}>
            שמור
          </button>
        </div>
      )}

      {styles.length === 0 ? (
        <div className="style-empty">עדיין אין סגנונות שמורים</div>
      ) : (
        <div className="style-chips">
          {styles.map((s) => (
            <span className="chip" key={s.id}>
              <button
                className="chip-apply"
                title="החל את הסגנון"
                onClick={() => onApply(cloneRecipe(s.recipe))}
              >
                {s.name}
              </button>
              <button
                className="chip-del"
                title="מחק סגנון"
                onClick={() => setStyles(deleteStyle(s.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
