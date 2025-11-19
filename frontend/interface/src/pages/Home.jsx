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
    const [selectedDate, setSelectedDate] = useState("");
    const [dataSource, setDataSource] = useState("wireless"); // "sd" or "wireless"

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
                <PixelBlast variant="circle" 
                    pixelSize={8} 
                    color="#B19EEF" 
                    patternScale={1} 
                    patternDensity={1} 
                    pixelSizeJitter={0.5} 
                    enableRipples speed={0.4} 
                    edgeFade={0} 
                    transparent={true} 
                /> 
            </div>
            
            <motion.div
                initial={{ y: 0 }}
                animate={showButtons ? { y: "-35vh" } : { y: 0 }}
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
                    transition={{
                        delay: 1.2,
                        duration: 1.5,
                        scale: { type: "spring", visualDuration: 1, bounce: 0.2 },
                    }}
                    className="relative z-30 w-full h-full flex flex-col gap-6 items-center justify-center pointer-events-none"
                >
                    <div className="cards-container">
                        <div className="mode-card">
                            <div>
                                <h2>Live Telemetry</h2>
                                <p>Stream real-time CAN & sensor data from the car.</p>
                                <div className="card-content">
                                    <p className="card-details">Monitor critical metrics including:</p>
                                    <ul className="feature-list">
                                        <li>Inverter RPM & Temperature</li>
                                        <li>Battery Temperature & Voltage</li>
                                        <li>Motor Performance Data</li>
                                        <li>Real-time CAN Bus Signals</li>
                                    </ul>
                                </div>
                            </div>
                            <Link to="/dash" className="card-btn">ENTER</Link>
                        </div>

                        <div className="mode-card">
                            <div>
                                <h2>Replay Sessions</h2>
                                <p>Review past sessions with timeline-based playback.</p>

                                <div className="card-form">
                                    <label className="form-label">
                                        Select Date
                                        <input
                                            type="date"
                                            className="date-input"
                                            value={selectedDate}
                                            onChange={(e) => setSelectedDate(e.target.value)}
                                        />
                                    </label>

                                    <div className="toggle-group">
                                        <span className="form-label">Data Source</span>
                                        <div className="toggle-buttons">
                                            <button
                                                className={`toggle-btn ${dataSource === 'sd' ? 'active' : ''}`}
                                                onClick={() => setDataSource('sd')}
                                            >
                                                SD Card
                                            </button>
                                            <button
                                                className={`toggle-btn ${dataSource === 'wireless' ? 'active' : ''}`}
                                                onClick={() => setDataSource('wireless')}
                                            >
                                                Wireless
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <Link to="/replay" className="card-btn secondary">OPEN</Link>
                        </div>

                    </div>
                </motion.div>
            )}
        </div>
    );
}
