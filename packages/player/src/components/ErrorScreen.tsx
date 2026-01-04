interface ErrorScreenProps {
  title?: string;
  message: string;
}

export function ErrorScreen({ title = 'Error', message }: ErrorScreenProps) {
  return (
    <div className="error-screen">
      <h1 className="error-title">{title}</h1>
      <p className="error-message">{message}</p>
    </div>
  );
}
