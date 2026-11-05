import './legal-consent.css';

export function LegalConsent({ terms, data = false, account = false, onTerms, onData }: {
  terms: boolean; data?: boolean; account?: boolean;
  onTerms: (value: boolean) => void; onData?: (value: boolean) => void;
}) {
  return <div className="legal-consent" role="group" aria-label={account ? 'Xác nhận tài khoản và dữ liệu' : 'Xác nhận điều kiện mua hàng'}>
    <label className="legal-consent-choice">
      <input type="checkbox" checked={terms} onChange={e => onTerms(e.target.checked)} />
      <span>{account ? 'Tôi đã đọc và đồng ý với ' : 'Tôi đã kiểm tra sản phẩm, số lượng, giá, giao hàng và bảo hành; đồng ý với '}
        <a href="/terms" target="_blank" rel="noopener noreferrer">Điều khoản dịch vụ</a>
        {' và đã đọc '}<a href="/privacy" target="_blank" rel="noopener noreferrer">Chính sách bảo mật</a>.
      </span>
    </label>
    {account && <label className="legal-consent-choice">
      <input type="checkbox" checked={data} onChange={e => onData?.(e.target.checked)} />
      <span>Tôi đồng ý để KEYNEST xử lý tên, email, thông tin đăng nhập/hồ sơ cần thiết nhằm tạo, duy trì và bảo vệ tài khoản theo Chính sách bảo mật. Xác nhận này không bao gồm quảng cáo.</span>
    </label>}
    {account && <p>Có thể rút lại sự đồng ý qua Trung tâm hỗ trợ. Không đồng ý phần cần thiết sẽ không thể tạo tài khoản; bạn vẫn xem được nội dung công khai.</p>}
  </div>;
}
