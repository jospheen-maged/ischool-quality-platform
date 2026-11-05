type Props = {
  saved: boolean;
  storageError: boolean;
  disabled: boolean;
  onDiscard: () => void;
};

export function FormDraftStatus({ saved, storageError, disabled, onDiscard }: Props) {
  return (
    <div className={storageError ? 'alert alert-error' : 'alert'} role="status">
      <span>{storageError
        ? 'Automatic saving is unavailable. Use Save draft before leaving this page.'
        : saved ? 'Draft saved automatically on this device.' : 'Changes are saved automatically on this device.'}</span>
      {' '}
      <button className="button button-secondary" type="button" disabled={disabled} onClick={() => {
        if (window.confirm('Discard the unsaved form and start again? Saved reviews will not be deleted.')) onDiscard();
      }}>Start new form</button>
    </div>
  );
}
