import GridLayout from "react-grid-layout";
import Navbar from '../components/navBar';
import BaseDashboard from "@/widgets/BaseDash";
import './Dash.css'

export default function Dashboard() {
    return (
        <>
            <Navbar />
            <BaseDashboard />
        </>
    );
}