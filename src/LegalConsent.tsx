import './legal-consent.css';

export function LegalConsent({ terms, data = false, account = false, onTerms, onData }: {
  terms: boolean; data?: boolean; account?: boolean;
  onTerms: (value: boolean) => void; onData?: (value: boolean) => void;
}) {
  return <div className="legal-consent" role="group" aria-label={account ? 'Xác nhận tài khoản và dữ liệu' : 'Xác nhận điều kiện mua hàng'}>
    <label className="legal-consent-choice">
      <input type="checkbox" checked={terms} onChange={e => onTerms(e.target.checked)} />
      <span>{account ? 'Tôi đồng ý với ' : 'Tôi đã kiểm tra sản phẩm, số lượng, giá, giao hàng và bảo hành; đồng ý với '}
        <a href="/terms" target="_blank" rel="noopener noreferrer">Điều khoản dịch vụ</a>
        {' và đã đọc '}<a href="/privacy" target="_blank" rel="noopener noreferrer">Chính sách bảo mật</a>.
      </span>
    </label>
    {account && <label className="legal-consent-choice">
      <input type="checkbox" checked={data} onChange={e => onData?.(e.target.checked)} />
      <span>Tôi đồng ý để KEYNEST xử lý tên, email và hồ sơ để cung cấp, bảo vệ tài khoản; không gồm quảng cáo.</span>
    </label>}
  </div>;
}
