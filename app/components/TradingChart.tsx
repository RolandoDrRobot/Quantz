"use client";

export default function TradingChart() {
  const src =
    "https://www.tradingview.com/widgetembed/?frameElementId=tv_chart" +
    "&symbol=CAPITALCOM%3AUS100" +
    "&interval=5" +
    "&theme=dark" +
    "&style=1" +
    "&timezone=America%2FCosta_Rica" +
    "&toolbar_bg=%230a0a0a" +
    "&hide_top_toolbar=0" +
    "&hide_legend=0" +
    "&save_image=0" +
    "&locale=es";

  return (
    <iframe
      src={src}
      className="w-full h-full border-0"
      allowTransparency={true}
      allowFullScreen={true}
      title="NASDAQ US100 Chart"
    />
  );
}
