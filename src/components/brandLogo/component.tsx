import React from "react";
import "./brandLogo.css";

interface BrandLogoProps {
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const BrandLogo: React.FC<BrandLogoProps> = ({
  onClick,
  className = "",
  style,
}) => {
  return (
    <div
      className={`coread-brand-logo ${className}`}
      onClick={onClick}
      style={style}
      title="CoRead 团队共读平台"
    >
      <svg
        className="coread-logo-icon"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Left Reader (Silhouette) */}
        <circle cx="13" cy="9.5" r="3.2" fill="currentColor" />
        <path
          d="M7 20C7 15.2 9.8 13.8 13 13.8C16.2 13.8 18.2 15.6 18.8 20C15.8 19.4 13.2 19.6 9.5 20Z"
          fill="currentColor"
        />

        {/* Right Reader (Silhouette) */}
        <circle cx="27" cy="9.5" r="3.2" fill="currentColor" />
        <path
          d="M33 20C33 15.2 30.2 13.8 27 13.8C23.8 13.8 21.8 15.6 21.2 20C24.2 19.4 26.8 19.6 30.5 20Z"
          fill="currentColor"
        />

        {/* Center Shared Connection Ribbon */}
        <path
          d="M18.8 19.8C19.5 18.5 20.5 18.5 21.2 19.8L20 22L18.8 19.8Z"
          fill="currentColor"
        />

        {/* Shared Open Book - Left Page */}
        <path
          d="M6 21.8C10.5 20.8 15 21.2 19 23.4V31C15 28.8 10.5 28.4 6 29.4V21.8Z"
          fill="currentColor"
        />

        {/* Shared Open Book - Right Page */}
        <path
          d="M34 21.8C29.5 20.8 25 21.2 21 23.4V31C25 28.8 29.5 28.4 34 29.4V21.8Z"
          fill="currentColor"
        />

        {/* Inner page line accents for texture */}
        <path
          d="M9 24.5C12 23.8 15 24.1 17.5 25.5"
          stroke="#ffffff"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.35"
        />
        <path
          d="M31 24.5C28 23.8 25 24.1 22.5 25.5"
          stroke="#ffffff"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.35"
        />
      </svg>

      <div className="coread-logo-text">
        <div className="coread-logo-title">
          <span className="coread-logo-co">Co</span>
          <span className="coread-logo-read">Read</span>
        </div>
        <div className="coread-logo-subtitle">CO-READING</div>
      </div>
    </div>
  );
};

export default BrandLogo;
