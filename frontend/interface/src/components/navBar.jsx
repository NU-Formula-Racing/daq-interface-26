import './navBar.css';
import { Link } from 'react-router-dom';
import logo from '../assets/nfr_logo.png';
import ShinyText from './ui/ShinyText';

export default function Navbar() {
    return (
        <nav className="navbar">
            <Link to="/" className="navbar-left">
                <img src={logo} alt="Logo" className="navbar-logo" />
                <ShinyText text="NFR Interface" className="navbar-title" />
            </Link>
            <ul className="navbar-links">
                <li><Link to="/dash">Dashboard</Link></li>
                <li><Link to="/graph">Graph</Link></li>
                <li><Link to="/map">Map</Link></li>
            </ul>
        </nav>
    );
}