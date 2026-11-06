// The demo's small outline icons, without adding an icon or animation runtime.
export function DemoIcon({
  name,
  size = 20,
}: {
  name:
    | 'arrow'
    | 'back'
    | 'music'
    | 'settings'
    | 'drop'
    | 'crystal'
    | 'play'
    | 'pause';
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill={
        name === 'crystal' ||
        name === 'drop' ||
        name === 'play' ||
        name === 'pause'
          ? 'currentColor'
          : 'none'
      }
      stroke="currentColor"
      strokeWidth={name === 'music' ? 8 : 16}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'arrow' ? (
        <path d="M64 192 192 64M64 64h128v128" />
      ) : name === 'back' ? (
        <path d="m104 48-80 80 80 80M24 128h208" />
      ) : name === 'settings' ? (
        <>
          <path d="M40 64h176M40 128h176M40 192h176" />
          <circle cx="88" cy="64" r="16" fill="var(--ink)" />
          <circle cx="168" cy="128" r="16" fill="var(--ink)" />
          <circle cx="104" cy="192" r="16" fill="var(--ink)" />
        </>
      ) : name === 'music' ? (
        <>
          <path d="M104 184V48l112-24v136M104 80l112-24" />
          <ellipse cx="80" cy="184" rx="24" ry="16" />
          <ellipse cx="192" cy="160" rx="24" ry="16" />
        </>
      ) : name === 'crystal' ? (
        <g strokeWidth="0">
          <path d="m128 20 76 108-76 108L52 128Z" fill="#75b8dd" />
          <path d="m128 20 0 108H52Z" fill="#c0e0ee" />
          <path d="m128 128 76 0-76 108Z" fill="#438cb8" />
          <path
            d="m128 20 76 108-76 108L52 128Z"
            fill="none"
            stroke="#b1d6e8"
            strokeWidth="5"
          />
        </g>
      ) : name === 'drop' ? (
        <path
          d="M128 24S56 104 56 160a72 72 0 0 0 144 0c0-56-72-136-72-136Z"
          strokeWidth="0"
        />
      ) : name === 'pause' ? (
        <>
          <rect x="64" y="40" width="40" height="176" rx="6" strokeWidth="0" />
          <rect x="152" y="40" width="40" height="176" rx="6" strokeWidth="0" />
        </>
      ) : (
        <path d="m72 32 152 96-152 96Z" strokeWidth="0" />
      )}
    </svg>
  );
}
