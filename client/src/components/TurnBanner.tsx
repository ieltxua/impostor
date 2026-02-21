interface TurnBannerProps {
  speakerName?: string;
  timeRemaining?: number;
}

export function TurnBanner({ speakerName, timeRemaining }: TurnBannerProps) {
  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12 }}>
      <h4 style={{ marginTop: 0 }}>Current Turn</h4>
      <p style={{ marginBottom: 0 }}>
        Speaker: <strong>{speakerName ?? 'Pending'}</strong>
      </p>
      <p style={{ marginBottom: 0 }}>
        Time remaining: <strong>{timeRemaining ?? 'manual'}</strong>
      </p>
    </section>
  );
}
