export function AkLogo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <clipPath id="headerSquircleClip">
          <rect x="16" y="16" width="480" height="480" rx="112" />
        </clipPath>
        <linearGradient id="headerBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="35%" stopColor="#2563eb" />
          <stop offset="75%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="headerRim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#bae6fd" stopOpacity="0.75" />
          <stop offset="35%" stopColor="#38bdf8" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#1e40af" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="headerCardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f1f5f9" />
        </linearGradient>
        <linearGradient id="headerLaserGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset="15%" stopColor="#38bdf8" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="85%" stopColor="#38bdf8" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="headerCurtainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="headerSymbolGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e40af" />
          <stop offset="60%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
        <linearGradient id="headerBracketGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <filter id="headerCardShadow" x="-20%" y="-15%" width="140%" height="140%">
          <feDropShadow dx="0" dy="20" stdDeviation="22" floodColor="#020617" floodOpacity="0.45" />
        </filter>
        <filter id="headerLaserGlow" x="-20%" y="-100%" width="140%" height="300%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g clipPath="url(#headerSquircleClip)">
        <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#headerBg)" />
        <ellipse cx="180" cy="80" rx="220" ry="140" fill="#60a5fa" opacity="0.2" />
        <rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="url(#headerRim)" strokeWidth="3" />

        <g filter="url(#headerCardShadow)">
          <rect x="124" y="94" width="264" height="324" rx="26" fill="url(#headerCardGrad)" />
          <path d="M 332 94 L 388 150 L 350 150 A 18 18 0 0 1 332 132 Z" fill="#cbd5e1" />
          <path d="M 332 94 L 388 150" stroke="#94a3b8" strokeWidth="1.5" opacity="0.5" />
        </g>

        <g fill="url(#headerSymbolGrad)" transform="translate(162, 310) scale(0.063, -0.063)">
          <path d="M0 0L500 1490L1060 1490L1565 0L1097 0L1026 245L528 245L455 0ZM624 565L934 565L930 578Q891 713 854 845Q817 977 781 1113Q744 977 706 845Q668 713 628 578Z" />
          <path transform="translate(1565, 0)" d="M80 0L80 1490L496 1490L496 859Q544 921 592 983Q640 1045 688 1107L984 1490L1465 1490L945 850L1493 0L1017 0L677 568L496 346L496 0Z" />
        </g>

        <rect x="170" y="348" width="172" height="8" rx="4" fill="#94a3b8" opacity="0.4" />
        <rect x="170" y="368" width="112" height="8" rx="4" fill="#94a3b8" opacity="0.25" />

        <polygon points="84,264 428,264 402,330 110,330" fill="url(#headerCurtainGrad)" />
        <rect x="80" y="261" width="352" height="6" rx="3" fill="url(#headerLaserGrad)" filter="url(#headerLaserGlow)" />

        <g fill="none" stroke="url(#headerBracketGrad)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 94 160 L 94 116 A 18 18 0 0 1 112 98 L 156 98" />
          <path d="M 356 98 L 400 98 A 18 18 0 0 1 418 116 L 418 160" />
          <path d="M 94 352 L 94 396 A 18 18 0 0 0 112 414 L 156 414" />
          <path d="M 356 414 L 400 414 A 18 18 0 0 0 418 396 L 418 352" />
        </g>
      </g>
    </svg>
  );
}
