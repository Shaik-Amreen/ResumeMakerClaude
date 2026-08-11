import { useState, createContext, useContext, useEffect, type ReactNode } from 'react';
import { AlertTriangle, Trash2, HelpCircle, X } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({ isOpen: true, options, resolve });
    });
  };

  const handleClose = (result: boolean) => {
    if (dialogState) {
      dialogState.resolve(result);
      setDialogState(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!dialogState?.isOpen) return;
      if (e.key === 'Escape') handleClose(false);
      else if (e.key === 'Enter') handleClose(true);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogState]);

  const variant = dialogState?.options.variant || 'danger';

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {dialogState?.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-[10px] animate-fade-in"
          onClick={() => handleClose(false)}
        >
          <div
            className="w-full max-w-md surface !bg-white/88 p-6 space-y-5 animate-scale-in relative"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => handleClose(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full text-ink-faint hover:text-ink hover:bg-black/[0.05] transition-transform duration-press active:scale-[0.97]"
            >
              <X size={16} />
            </button>

            <div className="flex items-start gap-4">
              <div
                className={`p-3 rounded-2xl shrink-0 ${
                  variant === 'danger'
                    ? 'bg-red-50 text-red-600'
                    : variant === 'warning'
                      ? 'bg-amber-50 text-amber-600'
                      : 'bg-cedar-soft text-cedar'
                }`}
              >
                {variant === 'danger' ? (
                  <Trash2 size={22} />
                ) : variant === 'warning' ? (
                  <AlertTriangle size={22} />
                ) : (
                  <HelpCircle size={22} />
                )}
              </div>

              <div className="space-y-1.5 min-w-0 pr-6">
                <h3 className="display-title text-lg text-ink">{dialogState.options.title}</h3>
                <div className="text-sm text-ink-muted leading-relaxed">
                  {dialogState.options.message}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleClose(false)}
                className="btn-secondary !text-sm !px-5 !py-2.5"
              >
                {dialogState.options.cancelText || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => handleClose(true)}
                className={`!px-5 !py-2.5 !text-sm rounded-full font-semibold text-white shadow-soft transition-[transform,background-color] duration-press active:scale-[0.97] ${
                  variant === 'danger'
                    ? 'bg-red-600 hover:bg-red-700'
                    : variant === 'warning'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-cedar hover:bg-cedar-hover'
                }`}
              >
                {dialogState.options.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context.confirm;
}
