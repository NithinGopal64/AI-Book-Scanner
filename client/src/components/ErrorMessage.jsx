import './ErrorMessage.css';

function ErrorMessage({ message }) {
  return (
    <div className="error-message">
      <span className="error-icon">⚠️</span>
      <div className="error-content">
        <strong>Error</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}

export default ErrorMessage;

