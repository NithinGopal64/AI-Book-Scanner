import './LoadingSpinner.css';

function LoadingSpinner({ size = 'large' }) {
  return (
    <div className={`spinner ${size}`}>
      <div className="spinner-ring"></div>
      <div className="spinner-ring"></div>
      <div className="spinner-ring"></div>
    </div>
  );
}

export default LoadingSpinner;

