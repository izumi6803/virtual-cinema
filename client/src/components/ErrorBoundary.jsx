import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui] uncaught render error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="boot" role="alert">
          <div className="boot__card">
            <p className="eyebrow">
              <span className="eyebrow__dot" />
              Virtual Cinema
            </p>
            <h1 className="boot__title">Đã xảy ra lỗi</h1>
            <p className="boot__text">{String(this.state.error.message || this.state.error)}</p>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => window.location.reload()}
            >
              Tải lại trang
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
