import { subcategories } from "./storefront.js";
import { productImages } from "./product-images.js";
export const catalog = [
  {
    slug: "elden-ring",
    name: "Elden Ring",
    category: "game",
    platform: "Steam",
    subtitle: "Một thế giới rộng lớn. Một hành trình của riêng bạn.",
    description:
      "Khám phá Lands Between trong tựa game nhập vai thế giới mở. Mã kích hoạt một lần trên tài khoản Steam cá nhân. Kiểm tra khu vực trước khi mua.",
    image:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg",
    featured: true,
    variants: [
      {
        name: "Standard Edition · Global",
        price: 690000,
        original_price: 990000,
        delivery: "key",
        stock: 12,
        region: "Global",
      },
    ],
  },
  {
    slug: "black-myth-wukong",
    name: "Black Myth: Wukong",
    category: "game",
    platform: "Steam",
    subtitle: "Viết tiếp truyền thuyết.",
    description:
      "Game hành động nhập vai lấy cảm hứng từ Tây Du Ký. Key Steam, kích hoạt vĩnh viễn trên tài khoản của bạn.",
    image:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2358720/header.jpg",
    featured: true,
    variants: [
      {
        name: "Standard Edition",
        price: 1090000,
        original_price: 1299000,
        delivery: "key",
        stock: 8,
        region: "Global",
      },
    ],
  },
  {
    slug: "cyberpunk-2077",
    name: "Cyberpunk 2077",
    category: "game",
    platform: "Steam",
    subtitle: "Night City đang chờ bạn.",
    description:
      "Nhập vai V và khám phá Night City. Phiên bản game gốc, không bao gồm Phantom Liberty.",
    image:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg",
    featured: true,
    variants: [
      {
        name: "Standard Edition",
        price: 395000,
        original_price: 990000,
        delivery: "key",
        stock: 18,
        region: "Global",
      },
    ],
  },
  {
    slug: "red-dead-redemption-2",
    name: "Red Dead Redemption 2",
    category: "game",
    platform: "Steam",
    subtitle: "Một câu chuyện miền viễn Tây.",
    description:
      "Khám phá thế giới của Arthur Morgan. Cần tài khoản Rockstar Games khi chơi.",
    image:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1174180/header.jpg",
    featured: true,
    variants: [
      {
        name: "Standard Edition",
        price: 349000,
        original_price: 1000000,
        delivery: "key",
        stock: 10,
        region: "Global",
      },
    ],
  },
  {
    slug: "hollow-knight",
    name: "Hollow Knight",
    category: "game",
    platform: "Steam",
    subtitle: "Bước vào vương quốc bị lãng quên.",
    description:
      "Cuộc phiêu lưu metroidvania với hình ảnh vẽ tay. Kích hoạt trên Steam.",
    image:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/367520/header.jpg",
    featured: false,
    variants: [
      {
        name: "Standard Edition",
        price: 99000,
        original_price: 165000,
        delivery: "key",
        stock: 20,
        region: "Global",
      },
    ],
  },
  {
    slug: "stardew-valley",
    name: "Stardew Valley",
    category: "game",
    platform: "Steam",
    subtitle: "Một cuộc sống mới ở nông trại.",
    description:
      "Xây nông trại, kết bạn và khám phá thung lũng theo cách riêng.",
    image:
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/header.jpg",
    featured: false,
    variants: [
      {
        name: "Standard Edition",
        price: 145000,
        original_price: 165000,
        delivery: "key",
        stock: 16,
        region: "Global",
      },
    ],
  },
  {
    slug: "steam-wallet",
    name: "Steam Wallet",
    category: "gift",
    platform: "Steam",
    subtitle: "Cả thư viện game, trong tầm tay.",
    description:
      "Mã nạp ví Steam. Chọn đúng tiền tệ và khu vực tài khoản. Mã chỉ sử dụng được một lần.",
    image: "",
    featured: true,
    variants: [
      {
        name: "100.000đ · Việt Nam",
        price: 105000,
        original_price: 105000,
        delivery: "key",
        stock: 30,
        region: "Việt Nam",
      },
      {
        name: "200.000đ · Việt Nam",
        price: 208000,
        original_price: 210000,
        delivery: "key",
        stock: 20,
        region: "Việt Nam",
      },
      {
        name: "500.000đ · Việt Nam",
        price: 515000,
        original_price: 525000,
        delivery: "key",
        stock: 12,
        region: "Việt Nam",
      },
    ],
  },
  {
    slug: "xbox-gift-card",
    name: "Xbox Gift Card",
    category: "gift",
    platform: "Xbox",
    subtitle: "Thêm lựa chọn cho cuộc chơi.",
    description:
      "Gift card cho Microsoft Store/Xbox. Chỉ áp dụng tài khoản khu vực Hoa Kỳ.",
    image: "",
    featured: false,
    variants: [
      {
        name: "10 USD · US",
        price: 265000,
        original_price: 285000,
        delivery: "key",
        stock: 15,
        region: "US",
      },
      {
        name: "25 USD · US",
        price: 649000,
        original_price: 695000,
        delivery: "key",
        stock: 10,
        region: "US",
      },
    ],
  },
  {
    slug: "valorant",
    name: "Valorant Points",
    category: "topup",
    platform: "Riot Games",
    subtitle: "Sẵn sàng cho bộ skin tiếp theo.",
    description:
      "Nạp VP cho tài khoản Việt Nam. Chỉ cần Riot ID và tag; không gửi mật khẩu. Quản trị viên xử lý sau khi thanh toán.",
    image: "",
    featured: true,
    variants: [
      {
        name: "625 VP",
        price: 120000,
        original_price: 130000,
        delivery: "manual",
        stock: 100,
        region: "Việt Nam",
      },
      {
        name: "1.250 VP",
        price: 235000,
        original_price: 260000,
        delivery: "manual",
        stock: 100,
        region: "Việt Nam",
      },
    ],
  },
  {
    slug: "genshin-impact",
    name: "Genshin Impact",
    category: "topup",
    platform: "HoYoverse",
    subtitle: "Tiếp sức cho chuyến phiêu lưu.",
    description:
      "Nạp qua UID và máy chủ. Ghi UID + server trong thông tin đơn hàng, không cung cấp mật khẩu.",
    image: "",
    featured: false,
    variants: [
      {
        name: "Welkin Moon · 30 ngày",
        price: 109000,
        original_price: 129000,
        delivery: "manual",
        stock: 100,
        region: "Global",
      },
      {
        name: "980 Genesis Crystals",
        price: 329000,
        original_price: 399000,
        delivery: "manual",
        stock: 100,
        region: "Global",
      },
    ],
  },
  {
    slug: "residential-proxy",
    name: "Residential Proxy",
    category: "mmo",
    platform: "Proxy",
    subtitle: "Kết nối phù hợp với công việc của bạn.",
    description:
      "Proxy dân cư cho kiểm thử ứng dụng và công việc được phép. Thông tin endpoint được quản trị viên giao qua đơn hàng, mã hóa khi lưu trữ. Không dùng cho hành vi vi phạm.",
    image: "",
    featured: true,
    variants: [
      {
        name: "1 GB · 30 ngày",
        price: 89000,
        original_price: 120000,
        delivery: "manual",
        stock: 100,
        region: "Global",
      },
      {
        name: "5 GB · 30 ngày",
        price: 390000,
        original_price: 450000,
        delivery: "manual",
        stock: 100,
        region: "Global",
      },
    ],
  },
  {
    slug: "private-proxy",
    name: "Private IPv4 Proxy",
    category: "mmo",
    platform: "Proxy",
    subtitle: "Một IP riêng. Một không gian làm việc.",
    description:
      "Proxy IPv4 riêng, giao host:port:user:password trong đơn hàng. Ghi quốc gia mong muốn để quản trị viên kiểm tra khả dụng.",
    image: "",
    featured: false,
    variants: [
      {
        name: "1 IP · 30 ngày",
        price: 49000,
        original_price: 69000,
        delivery: "manual",
        stock: 100,
        region: "US / SG",
      },
    ],
  },
].map((product) => ({
  ...product,
  image: product.image || productImages[product.slug] || "",
  subcategory: subcategories[product.slug] || product.platform,
}));
