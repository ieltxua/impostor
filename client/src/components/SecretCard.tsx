import { useRef, useState } from 'react';

import type { PlayerSecret } from '@impostor/shared';

interface SecretCardProps {
  secret?: PlayerSecret;
}

export function SecretCard({ secret }: SecretCardProps) {
  const [revealed, setRevealed] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const startReveal = () => {
    if (!secret?.revealAllowed) {
      return;
    }
    timeoutRef.current = window.setTimeout(() => {
      setRevealed(true);
    }, 700);
  };

  const stopReveal = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setRevealed(false);
  };

  return (
    <section
      style={{
        borderRadius: 14,
        border: '1px solid #ccc',
        padding: 16,
        background: revealed ? '#fdf6e3' : '#f9fafb'
      }}
    >
      <h3 style={{ marginTop: 0 }}>Secret</h3>
      {!secret && <p>Waiting for role assignment...</p>}
      {secret && !secret.revealAllowed && <p>Secret locked for this phase.</p>}
      {secret && secret.revealAllowed && (
        <button
          type="button"
          style={{ width: '100%', minHeight: 58 }}
          onMouseDown={startReveal}
          onMouseUp={stopReveal}
          onMouseLeave={stopReveal}
          onTouchStart={startReveal}
          onTouchEnd={stopReveal}
        >
          {revealed
            ? `Role: ${secret.role}${secret.wordOrNull ? ` | Word: ${secret.wordOrNull}` : ' | No word assigned'}`
            : 'Press and hold to reveal (0.7s)'}
        </button>
      )}
    </section>
  );
}
