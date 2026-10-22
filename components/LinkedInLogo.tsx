// LinkedIn's own "in" mark, drawn inline (no hotlinked asset), in LinkedIn's
// blue, so the link to someone's profile is recognised at a glance.
export function LinkedInLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="3" fill="#0a66c2" />
      <path fill="#fff" d="M5.3 9.3h2.9v9.4H5.3zm1.45-4.6a1.68 1.68 0 1 1 0 3.36 1.68 1.68 0 0 1 0-3.36M10 9.3h2.78v1.29h.04c.39-.73 1.33-1.5 2.74-1.5 2.93 0 3.47 1.93 3.47 4.43v5.18h-2.9v-4.6c0-1.1-.02-2.5-1.52-2.5-1.53 0-1.76 1.19-1.76 2.42v4.68H10z" />
    </svg>
  );
}
