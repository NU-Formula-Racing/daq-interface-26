import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from 'react-router-dom';
import "./Home.css";
import PixelBlast from "@/components/ui/PixelBlast";
import ShinyText from "@/components/ui/ShinyText";

export default function HomePage() {
    const [showButtons, setShowButtons] = useState(false);
    const [typedText, setTypedText] = useState("");
    const [showGlow, setShowGlow] = useState(false);

    const fullText = "NFR Interface";

    // Typewriter
    useEffect(() => {
        let i = 0;
        const interval = setInterval(() => {
            setTypedText(fullText.slice(0, i));
            i++;

            if (i > fullText.length) {
                clearInterval(interval);
                setTimeout(() => setShowButtons(true), 500);
            }
        }, 90);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (showButtons) {
            setTimeout(() => setShowGlow(true), 800);
        }
    }, [showButtons]);


    return (
        <div className="relative w-full h-screen overflow-hidden">

            {/* BACKGROUND LAYER (white + particles) */}
            <div className="absolute inset-0 w-full h-full z-0">
                <PixelBlast
                    variant="circle"
                    pixelSize={8}
                    color="#B19EEF"
                    patternScale={1}
                    patternDensity={1}
                    pixelSizeJitter={0.5}
                    enableRipples
                    speed={0.4}
                    edgeFade={0}
                    transparent={true}
                />
            </div>

            <motion.div
                initial={{ y: 0 }}
                animate={showButtons ? { y: "-25vh" } : { y: 0 }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none"
            >
                <div className="relative">

                    <motion.div
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={showGlow ? { opacity: 1, scale: 1 } : { opacity: 0 }}
                        transition={{ duration: 1.2, ease: "easeOut" }}
                        className="title-glow"
                    />

                    <motion.h1
                        initial={{ color: "#FFFFFF" }}
                        animate={showButtons ? { color: "#4E2A84" } : { color: "#FFFFFF" }}
                        transition={{ duration: 1.2, ease: "easeInOut" }}
                        className="text-5xl font-bold tracking-wide hero-title"
                    >
                        <ShinyText text={typedText} />
                    </motion.h1>

                </div>
            </motion.div>

            {/* BLACK OVERLAY (fades out ONLY) */}
            <motion.div
                initial={{ opacity: 1 }}
                animate={showButtons ? { opacity: 0 } : { opacity: 1 }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                className="absolute inset-0 bg-black z-10 pointer-events-none"
            />

            {/* BUTTONS (fade in after animation) */}
            {showButtons && (
                <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 4, scale: { type: "spring", visualDuration: 1.5, bounce: 0.3 }, }}
                    className="relative z-30 w-full h-full flex flex-col gap-6 items-center justify-center pointer-events-none"
                >
                    <div className="navigation pointer-events-auto">
                        <ol>
                            <Link to="/dash">
                                <button className="button transition">
                                    LIVE
                                </button>
                            </Link>
                        </ol>
                        <ol>
                            <Link to="/dash">
                                <button className="button transition">
                                    REPLAY
                                </button>
                            </Link>
                        </ol>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
