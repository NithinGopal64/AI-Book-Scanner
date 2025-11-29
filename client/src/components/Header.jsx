import './Header.css';

function Header({ activeSection, onNavClick }) {
  return (
    <header className="header">
      <div className="header-content">
        <div className="header-left">
          <div className="logo">
            <svg className="logo-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <h1>BookScanner</h1>
          </div>
        </div>
        <div className="header-right">
          <nav className="header-nav">
            <button 
              className={`nav-item ${activeSection === 'discover' ? 'active' : ''}`}
              onClick={() => onNavClick('discover')}
            >
              Discover
            </button>
            <button 
              className={`nav-item ${activeSection === 'library' ? 'active' : ''}`}
              onClick={() => onNavClick('library')}
            >
              Library
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
}

export default Header;

