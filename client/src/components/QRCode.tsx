interface QRCodeProps {
  roomCode: string;
}

export function QRCode({ roomCode }: QRCodeProps) {
  const joinUrl = `${window.location.origin}?room=${roomCode}`;

  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12, marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>Invite</h4>
      <p style={{ margin: 0 }}>
        Share code <strong>{roomCode}</strong> or link:
      </p>
      <code style={{ display: 'block', marginTop: 8, wordBreak: 'break-all' }}>{joinUrl}</code>
    </section>
  );
}
