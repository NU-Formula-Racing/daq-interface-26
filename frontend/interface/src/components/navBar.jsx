import './navBar.css';
import logo from '../assets/nfr_logo.png';
import ShinyText from './ui/ShinyText';

export default function Navbar() {
    return (
        <nav className="navbar">
            <div class="navbar-left">
                <img src={logo} alt="Logo" className="navbar-logo" />
                <ShinyText text="NFR Interface" className="navbar-title" />
            </div>
            <ul className="navbar-links">
                <li><a href="/">Home</a></li>
                <li><a href="/about">About</a></li>
            </ul>
        </nav>
    );
}