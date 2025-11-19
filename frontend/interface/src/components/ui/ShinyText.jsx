// src/components/ui/ShinyText.jsx
import React from "react";
import './ShinyText.css';

export default function ShinyText({ text, className = "" }) {
    return (
        <span
            className={`bg-[linear-gradient(110deg,#4E2A84,45%,#CBBBE3,55%,#4E2A84)] bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_4s_infinite_linear] ${className}`}
        >
            {text}
        </span>
    );
}
