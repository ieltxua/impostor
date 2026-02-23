import type { ThemePreference } from '../theme/useTheme';
import { t } from '../i18n';

interface ThemeToggleProps {
  preference: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}

export function ThemeToggle({ preference, onChange }: ThemeToggleProps) {
  const themeOptions: Array<{ value: ThemePreference; label: string }> = [
    { value: 'light', label: t('theme.lightLabel') },
    { value: 'dark', label: t('theme.darkLabel') }
  ];

  return (
    <div className="theme-toggle-wrap">
      <span className="theme-toggle-label">{t('theme.label')}</span>
      <div className="theme-toggle" aria-label={t('theme.ariaLabel')} data-testid="theme-toggle">
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === preference}
            onClick={() => onChange(option.value)}
            className={`theme-toggle__button ${option.value === preference ? 'theme-toggle__button--active' : ''}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="theme-toggle-state">
        {preference === 'light' ? t('theme.lightState') : t('theme.darkState')}
      </span>
    </div>
  );
}
