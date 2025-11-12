import './navBar.css';
import logo from '../assets/nfr_logo.png';

export default function Navbar() {
    return (
        <nav className="navbar">
            <div class="navbar-left">
                <img src={logo} alt="Logo" className="navbar-logo" />
                <h1 class="navbar-title">NFR Interface</h1>
            </div>
            <ul className="navbar-links">
                <li><a href="/">Home</a></li>
                <li><a href="/about">About</a></li>
            </ul>
        </nav>
    );
}