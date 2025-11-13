// src/components/SignalChart.jsx
import { useEffect, useState } from "react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { fetchSignal } from "../lib/fetchSignals";

export default function SignalChart({ signalName, color }) {
    const [data, setData] = useState([]);

    useEffect(() => {
        fetchSignal(signalName).then(setData);
        const interval = setInterval(() => fetchSignal(signalName).then(setData), 5000);
        return () => clearInterval(interval);
    }, [signalName]);

    return (
        <div className="w-full h-64 p-4">
            <h2 className="font-semibold text-lg mb-2">{signalName}</h2>

            {data.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400 italic">
                    No data available
                </div>
            ) : (
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="value" stroke={color} dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}
