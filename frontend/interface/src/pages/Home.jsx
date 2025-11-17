import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { SparklesCore } from "@/components/ui/shadcn-io/sparkles";
import { Link } from 'react-router-dom';
import "./Home.css";


export default function HomePage() {
    const [showButtons, setShowButtons] = useState(false);
    const [typedText, setTypedText] = useState("");
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

    return (
        <div className="relative w-full h-screen overflow-hidden">

            {/* BACKGROUND LAYER (white + particles) */}
            <div className="absolute inset-0 w-full h-full bg-white z-0">
                <SparklesCore
                    background="transparent"
                    minSize={1.4}
                    maxSize={3.0}
                    particleDensity={100}
                    className="absolute inset-0 w-full h-full"
                    particleColor="#4E2A84"
                    speed={1}
                />
            </div>

            {/* TEXT LAYER (slides up but NEVER fades) */}
            <motion.div
                initial={{ y: 0 }}
                animate={showButtons ? { y: "-25vh" } : { y: 0 }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none"
            >
                <motion.h1
                    initial={{ color: "#ffffff" }}          // start white
                    animate={showButtons ? { color: "#000000" } : { color: "#ffffff" }} // fade to black
                    transition={{ duration: 1.2, ease: "easeInOut" }}
                    className="text-5xl font-bold tracking-wide drop-shadow-xl"
                >
                    {typedText}
                </motion.h1>
            </motion.div>


            {/* BLACK OVERLAY (fades out ONLY) */}
            <motion.div
                initial={{ opacity: 1 }}
                animate={showButtons ? { opacity: 0 } : { opacity: 1 }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                className="absolute inset-0 bg-black z-10"
            />

            {/* BUTTONS (fade in after animation) */}
            {showButtons && (
                <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 4, scale: { type: "spring", visualDuration: 1.5, bounce: 0.3 }, }}
                    className="relative z-30 w-full h-full flex flex-col gap-6 items-center justify-center"
                >
                    <div className="navigation">
                        <button className="button text-white rounded-xl text-xl hover:bg-purple-700 transition">
                            Dashboard
                        </button>
                        <button className="button text-white rounded-xl text-xl hover:bg-gray-800 transition">
                            Documentation
                        </button>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
