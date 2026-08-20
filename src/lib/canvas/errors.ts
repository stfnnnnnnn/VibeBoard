export class CanvasAuthError extends Error {
  constructor(message = 'Canvas token is invalid or expired') {
    super(message);
    this.name = 'CanvasAuthError';
  }
}

export class CanvasApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CanvasApiError';
    this.status = status;
  }
}
