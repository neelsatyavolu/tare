/**
 * The source list. Lean labels are Tare's own editorial calls, informed by where each outlet's
 * audience sits in published audience research. They are shown on /method so readers can argue with them.
 * The left and right sides have the same number of outlets (12 each) so neither can outvote the other.
 * Section feeds (world, business, tech, sports...) come from outlets on every side, so the edition can
 * cover every kind of news, not just politics. Feeds whose items carry no dates are left out.
 */
export type Lean = "left" | "lean-left" | "center" | "lean-right" | "right";
export type Side = "left" | "center" | "right";

export type Outlet = { id: string; name: string; lean: Lean; feeds: string[] };

export const OUTLETS: readonly Outlet[] = [
  { id: "guardian", name: "The Guardian", lean: "left", feeds: ["https://www.theguardian.com/us-news/rss", "https://www.theguardian.com/world/rss", "https://www.theguardian.com/technology/rss", "https://www.theguardian.com/business/rss", "https://www.theguardian.com/sport/rss", "https://www.theguardian.com/science/rss", "https://www.theguardian.com/environment/rss", "https://www.theguardian.com/culture/rss"] },
  { id: "vox", name: "Vox", lean: "left", feeds: ["https://www.vox.com/rss/index.xml"] },
  { id: "slate", name: "Slate", lean: "left", feeds: ["https://slate.com/feeds/all.rss", "https://slate.com/feeds/business.rss"] },
  { id: "salon", name: "Salon", lean: "left", feeds: ["https://www.salon.com/feed/"] },
  { id: "motherjones", name: "Mother Jones", lean: "left", feeds: ["https://www.motherjones.com/feed/"] },
  { id: "nyt", name: "The New York Times", lean: "lean-left", feeds: ["https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "https://rss.nytimes.com/services/xml/rss/nyt/US.xml", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml", "https://rss.nytimes.com/services/xml/rss/nyt/Health.xml", "https://rss.nytimes.com/services/xml/rss/nyt/Climate.xml", "https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml"] },
  { id: "npr", name: "NPR", lean: "lean-left", feeds: ["https://feeds.npr.org/1001/rss.xml", "https://feeds.npr.org/1004/rss.xml", "https://feeds.npr.org/1006/rss.xml", "https://feeds.npr.org/1019/rss.xml", "https://feeds.npr.org/1007/rss.xml", "https://feeds.npr.org/1128/rss.xml", "https://feeds.npr.org/1055/rss.xml"] },
  { id: "nbc", name: "NBC News", lean: "lean-left", feeds: ["https://feeds.nbcnews.com/nbcnews/public/news", "https://feeds.nbcnews.com/nbcnews/public/world", "https://feeds.nbcnews.com/nbcnews/public/health"] },
  { id: "cbs", name: "CBS News", lean: "lean-left", feeds: ["https://www.cbsnews.com/latest/rss/main", "https://www.cbsnews.com/latest/rss/world", "https://www.cbsnews.com/latest/rss/us", "https://www.cbsnews.com/latest/rss/moneywatch", "https://www.cbsnews.com/latest/rss/technology", "https://www.cbsnews.com/latest/rss/science", "https://www.cbsnews.com/latest/rss/health", "https://www.cbsnews.com/latest/rss/entertainment"] },
  { id: "abc", name: "ABC News", lean: "lean-left", feeds: ["https://abcnews.go.com/abcnews/topstories", "https://abcnews.go.com/abcnews/internationalheadlines", "https://abcnews.go.com/abcnews/usheadlines", "https://abcnews.go.com/abcnews/moneyheadlines", "https://abcnews.go.com/abcnews/technologyheadlines", "https://abcnews.go.com/abcnews/sportsheadlines"] },
  { id: "atlantic", name: "The Atlantic", lean: "lean-left", feeds: ["https://www.theatlantic.com/feed/all/"] },
  { id: "politico", name: "Politico", lean: "lean-left", feeds: ["https://rss.politico.com/politics-news.xml"] },
  { id: "bbc", name: "BBC News", lean: "center", feeds: ["https://feeds.bbci.co.uk/news/world/rss.xml", "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", "https://feeds.bbci.co.uk/news/business/rss.xml", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", "https://feeds.bbci.co.uk/news/health/rss.xml", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", "https://feeds.bbci.co.uk/sport/rss.xml"] },
  { id: "pbs", name: "PBS NewsHour", lean: "center", feeds: ["https://www.pbs.org/newshour/feeds/rss/headlines", "https://www.pbs.org/newshour/feeds/rss/world", "https://www.pbs.org/newshour/feeds/rss/economy", "https://www.pbs.org/newshour/feeds/rss/science", "https://www.pbs.org/newshour/feeds/rss/health"] },
  { id: "thehill", name: "The Hill", lean: "center", feeds: ["https://thehill.com/feed/", "https://thehill.com/policy/technology/feed/", "https://thehill.com/business/feed/", "https://thehill.com/policy/healthcare/feed/", "https://thehill.com/policy/energy-environment/feed/"] },
  { id: "axios", name: "Axios", lean: "center", feeds: ["https://api.axios.com/feed/"] },
  { id: "bloomberg", name: "Bloomberg", lean: "center", feeds: ["https://feeds.bloomberg.com/politics/news.rss", "https://feeds.bloomberg.com/markets/news.rss", "https://feeds.bloomberg.com/technology/news.rss"] },
  { id: "cnbc", name: "CNBC", lean: "center", feeds: ["https://www.cnbc.com/id/100003114/device/rss/rss.html", "https://www.cnbc.com/id/19854910/device/rss/rss.html", "https://www.cnbc.com/id/100727362/device/rss/rss.html"] },
  { id: "newsnation", name: "NewsNation", lean: "center", feeds: ["https://www.newsnationnow.com/feed/"] },
  { id: "csmonitor", name: "The Christian Science Monitor", lean: "center", feeds: ["https://rss.csmonitor.com/feeds/all"] },
  { id: "upi", name: "UPI", lean: "center", feeds: ["https://rss.upi.com/news/top_news.rss", "https://rss.upi.com/news/world_news.rss", "https://rss.upi.com/news/sports_news.rss", "https://rss.upi.com/news/entertainment_news.rss"] },
  { id: "newsweek", name: "Newsweek", lean: "center", feeds: ["https://www.newsweek.com/rss"] },
  { id: "nypost", name: "New York Post", lean: "lean-right", feeds: ["https://nypost.com/feed/", "https://nypost.com/world-news/feed/", "https://nypost.com/business/feed/", "https://nypost.com/tech/feed/", "https://nypost.com/sports/feed/", "https://nypost.com/entertainment/feed/"] },
  { id: "washexam", name: "Washington Examiner", lean: "lean-right", feeds: ["https://www.washingtonexaminer.com/feed", "https://www.washingtonexaminer.com/policy/feed"] },
  { id: "washtimes", name: "The Washington Times", lean: "lean-right", feeds: ["https://www.washingtontimes.com/rss/headlines/news/", "https://www.washingtontimes.com/rss/headlines/news/world/", "https://www.washingtontimes.com/rss/headlines/news/business-economy/", "https://www.washingtontimes.com/rss/headlines/culture/technology/", "https://www.washingtontimes.com/rss/headlines/sports/"] },
  { id: "reason", name: "Reason", lean: "lean-right", feeds: ["https://reason.com/feed/"] },
  { id: "dispatch", name: "The Dispatch", lean: "lean-right", feeds: ["https://thedispatch.com/feed/"] },
  { id: "fox", name: "Fox News", lean: "right", feeds: ["https://moxie.foxnews.com/google-publisher/latest.xml", "https://moxie.foxnews.com/google-publisher/world.xml", "https://moxie.foxnews.com/google-publisher/us.xml", "https://moxie.foxnews.com/google-publisher/politics.xml", "https://moxie.foxnews.com/google-publisher/tech.xml", "https://moxie.foxnews.com/google-publisher/health.xml", "https://moxie.foxnews.com/google-publisher/entertainment.xml"] },
  { id: "natreview", name: "National Review", lean: "right", feeds: ["https://www.nationalreview.com/feed/"] },
  { id: "dailywire", name: "The Daily Wire", lean: "right", feeds: ["https://www.dailywire.com/feeds/rss.xml"] },
  { id: "federalist", name: "The Federalist", lean: "right", feeds: ["https://thefederalist.com/feed/"] },
  { id: "breitbart", name: "Breitbart", lean: "right", feeds: ["https://feeds.feedburner.com/breitbart", "https://feeds.feedburner.com/breitbart/world"] },
  { id: "dailycaller", name: "The Daily Caller", lean: "right", feeds: ["https://dailycaller.com/feed/"] },
  { id: "freebeacon", name: "Washington Free Beacon", lean: "right", feeds: ["https://freebeacon.com/feed/"] },
];

const BY_ID = new Map(OUTLETS.map((o) => [o.id, o]));

export function outletById(id: string): Outlet | undefined {
  return BY_ID.get(id);
}

export function sideOf(lean: Lean): Side {
  if (lean === "left" || lean === "lean-left") return "left";
  if (lean === "right" || lean === "lean-right") return "right";
  return "center";
}

export const LEAN_LABEL: Record<Lean, string> = {
  left: "Left",
  "lean-left": "Leans left",
  center: "Center",
  "lean-right": "Leans right",
  right: "Right",
};

/** How many outlets sit on each side, used to turn counts into shares. */
export const SIDE_SIZE: Record<Side, number> = OUTLETS.reduce(
  (acc, o) => ({ ...acc, [sideOf(o.lean)]: acc[sideOf(o.lean)] + 1 }),
  { left: 0, center: 0, right: 0 } as Record<Side, number>,
);
