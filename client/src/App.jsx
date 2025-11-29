import { useState, useRef } from 'react';
import Header from './components/Header';
import ImageUpload from './components/ImageUpload';
import BookCarousel from './components/BookCarousel';
import ScrollAnimation from './components/ScrollAnimation';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorMessage from './components/ErrorMessage';
import { uploadScan } from './api';
import './App.css';

// Helper function to convert text to Title Case
function toTitleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function App() {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [activeSection, setActiveSection] = useState('discover');
  const uploadSectionRef = useRef(null);
  const librarySectionRef = useRef(null);

  const handleScan = async (imageFile) => {
    setScanning(true);
    setError(null);
    setScanResult(null);

    try {
      const result = await uploadScan(imageFile);
      setScanResult(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to scan image');
      console.error('Scan error:', err);
    } finally {
      setScanning(false);
    }
  };

  const handleNavClick = (section) => {
    setActiveSection(section);
    if (section === 'discover' && uploadSectionRef.current) {
      uploadSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (section === 'library' && librarySectionRef.current) {
      librarySectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="app">
      <Header activeSection={activeSection} onNavClick={handleNavClick} />
      <main className="main-content">
        <div className="container">
          <div ref={uploadSectionRef}>
            <ImageUpload 
              onUpload={handleScan} 
              disabled={scanning}
            />
          </div>

          {scanning && (
            <div className="scanning-status">
              <LoadingSpinner />
              <p>Scanning your bookshelf... This may take a moment.</p>
            </div>
          )}

          {error && <ErrorMessage message={error} />}

          {scanResult && (
            <>
              {scanResult.scannedTitles && scanResult.scannedTitles.length > 0 && (
                <ScrollAnimation>
                  <section className="section">
                    <h2 className="section-title">
                      Detected Titles
                      <span className="title-count">({scanResult.scannedTitles.length})</span>
                    </h2>
                    <ul className="titles-list">
                      {scanResult.scannedTitles.map((title, index) => (
                        <li 
                          key={index} 
                          className="title-item"
                          style={{ animationDelay: `${index * 0.08}s` }}
                        >
                          <span className="title-number">{index + 1}</span>
                          <p className="title-text">{toTitleCase(title)}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                </ScrollAnimation>
              )}

              {scanResult.matches && scanResult.matches.length > 0 && (
                <ScrollAnimation delay={100}>
                  <section className="section" ref={librarySectionRef}>
                    <BookCarousel 
                      books={scanResult.matches} 
                      title={`Your Books (${scanResult.matches.length})`}
                    />
                  </section>
                </ScrollAnimation>
              )}

              {scanResult.recommendations && scanResult.recommendations.length > 0 && (
                <ScrollAnimation delay={200}>
                  <BookCarousel 
                    books={scanResult.recommendations} 
                    title="Recommendations for You"
                  />
                </ScrollAnimation>
              )}
            </>
          )}

          {!scanning && !scanResult && !error && (
            <ScrollAnimation>
              <div className="welcome-message">
                <div className="welcome-content">
                  <h2 className="welcome-title">Discover Your Next Great Read</h2>
                  <p className="welcome-description">
                    Simply upload a photo of your bookshelf and let AI-powered technology provide personalized recommendations 
                    tailored to your reading preferences.
                  </p>
                  <div className="features-grid">
                    <div className="feature-card">
                      <div className="feature-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                      </div>
                      <h3 className="feature-title">Upload Image</h3>
                      <p className="feature-text">Take or upload a photo of your bookshelf</p>
                    </div>
                    <div className="feature-card">
                      <div className="feature-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                          <line x1="12" y1="22.08" x2="12" y2="12" />
                        </svg>
                      </div>
                      <h3 className="feature-title">AI Extraction</h3>
                      <p className="feature-text">Automatic title detection using computer vision</p>
                    </div>
                    <div className="feature-card">
                      <div className="feature-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                      </div>
                      <h3 className="feature-title">Rich Metadata</h3>
                      <p className="feature-text">Comprehensive book information and details</p>
                    </div>
                    <div className="feature-card">
                      <div className="feature-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </div>
                      <h3 className="feature-title">Smart Recommendations</h3>
                      <p className="feature-text">Personalized suggestions based on your collection</p>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollAnimation>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;

