import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { CheerioCrawler, Dataset, KeyValueStore, ProxyConfiguration, EnqueueStrategy } from "crawlee";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  // Store active crawlers to manage them
  const activeCrawlers = new Map();

  app.use(express.json());

  // API Routes
  app.post("/api/crawl", async (req, res) => {
    const { url, selectors, keywords, limit, type } = req.body;
    const jobId = Date.now().toString();

    // Start crawling in background
    startCrawler(jobId, url, selectors, keywords, limit, type, io, activeCrawlers);

    res.json({ jobId, message: "Crawler started" });
  });

  app.post("/api/gather", async (req, res) => {
    const { topic, keywords, limit, selectors } = req.body;
    const jobId = Date.now().toString();
    
    // Start gathering in background
    startGatherer(jobId, topic, keywords, limit, selectors, io, activeCrawlers);

    res.json({ jobId, message: "Gatherer started" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static file serving would go here
    app.use(express.static("dist"));
  }

  io.on("connection", (socket) => {
    console.log("Client connected");
    socket.on("stop-crawl", ({ jobId }) => {
      console.log(`Stopping job ${jobId}`);
      const crawler = activeCrawlers.get(jobId);
      if (crawler) {
        crawler.teardown(); // Best effort stop
        activeCrawlers.delete(jobId);
      }
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Crawler Logic
async function startCrawler(jobId, url, selectors, keywords, limit, type, io, activeCrawlers) {
  try {
    // Normalize selectors
    const normalizedSelectors = Array.isArray(selectors) 
      ? selectors.map(s => s.toLowerCase().trim()) 
      : (selectors ? selectors.split(',').map(s => s.toLowerCase().trim()) : []);

    const crawler = new CheerioCrawler({
      maxRequestsPerCrawl: parseInt(limit) || 50,
      async requestHandler({ $, request, enqueueLinks }) {
        if (!activeCrawlers.has(jobId)) return;
        const title = $("title").text();
        const extractedData: any = {
          url: request.url,
          title,
          type: "page",
          timestamp: new Date().toISOString(),
        };

        // Extract based on selectors
        // Check for 'heading' or 'headings'
        if (normalizedSelectors.some(s => s.includes("heading"))) {
          const headings = $("h1, h2, h3").map((i, el) => $(el).text().trim()).get().filter(t => t.length > 0);
          extractedData.headings = [...new Set(headings)]; // De-dupe
        }
        // Check for 'text' or 'paragraph'
        if (normalizedSelectors.some(s => s.includes("text") || s.includes("paragraph"))) {
          extractedData.text = $("p").map((i, el) => $(el).text().trim()).get().filter(t => t.length > 0);
        }
        // Check for 'meta'
        if (normalizedSelectors.some(s => s.includes("meta"))) {
          extractedData.meta = {
            description: $('meta[name="description"]').attr("content"),
            keywords: $('meta[name="keywords"]').attr("content"),
          };
        }
        // Check for 'image' or 'images'
        if (normalizedSelectors.some(s => s.includes("image"))) {
          const images = $("img").map((i, el) => ({
            src: $(el).attr("src"),
            alt: $(el).attr("alt"),
          })).get().filter(img => img.src);
          
          // De-dupe images by src
          extractedData.images = images.filter((v, i, a) => a.findIndex(t => (t.src === v.src)) === i);
        }
        // Check for 'link' or 'links' or 'url'
        if (normalizedSelectors.some(s => s.includes("link") || s.includes("url"))) {
           const links = $("a").map((i, el) => $(el).attr("href")).get().filter(l => l);
           extractedData.links = [...new Set(links)]; // De-dupe
        }

        // Keyword filtering
        let matchesKeywords = true;
        if (keywords && keywords.length > 0) {
          const pageText = $("body").text().toLowerCase();
          const keywordList = keywords.split(",").map(k => k.trim().toLowerCase());
          matchesKeywords = keywordList.some(k => pageText.includes(k));
        }

        if (matchesKeywords) {
          // Emit data to client
          io.emit(`crawl-data-${jobId}`, extractedData);
        }
          
        // Enqueue more links regardless of match to ensure traversal
        await enqueueLinks();
      },
    });

    activeCrawlers.set(jobId, crawler);
    await crawler.run([url]);
    activeCrawlers.delete(jobId);
    io.emit(`crawl-complete-${jobId}`, { status: "completed" });

  } catch (error) {
    console.error("Crawler error:", error);
    io.emit(`crawl-error-${jobId}`, { error: error.message });
  }
}

// Gatherer Logic
async function startGatherer(jobId, topic, keywords, limit, selectors, io, activeCrawlers) {
  try {
    let searchTopic = topic || "";
    let searchKeywords = keywords || "";
    const targetLimit = parseInt(limit) || 50;
    let emittedCount = 0;

    if (!searchTopic && !searchKeywords) {
        throw new Error("No topic or keywords provided for search.");
    }

    // Normalize selectors
    const normalizedSelectors = Array.isArray(selectors) 
      ? selectors.map(s => s.toLowerCase().trim()) 
      : (selectors ? selectors.split(',').map(s => s.toLowerCase().trim()) : []);

    // Construct search URLs (pagination)
    const searchUrls = [];
    const itemsPerPage = 30;
    const maxPages = Math.min(5, Math.ceil(targetLimit / 5)); // Limit pages to avoid too much noise
    
    const query = `${searchTopic} ${searchKeywords}`.trim();
    
    for (let i = 0; i < maxPages; i++) {
        const offset = i * itemsPerPage;
        // Use DuckDuckGo HTML version
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${offset}`;
        searchUrls.push(url);
    }

    console.log(`[Job ${jobId}] Target Limit: ${targetLimit}`);
    console.log(`[Job ${jobId}] Search Query: ${query}`);
    console.log(`[Job ${jobId}] Search URLs:`, searchUrls);
    
    const crawler = new CheerioCrawler({
      maxRequestsPerCrawl: targetLimit * 5, 
      requestHandlerTimeoutSecs: 45,
      preNavigationHooks: [
          async (crawlingContext, gotoOptions) => {
              gotoOptions.headers = {
                  ...gotoOptions.headers,
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              };
          },
      ],
      async requestHandler({ $, request, enqueueLinks, log }) {
        if (!activeCrawlers.has(jobId)) return;
        
        if (emittedCount >= targetLimit) return;

        const isDDG = request.url.includes("duckduckgo.com");

        if (!isDDG) {
            const title = $("title").text().trim();
            const pageText = $("body").text().toLowerCase();
            
            // Check for keywords if provided
            let matchesKeywords = true;
            if (searchKeywords) {
               const keywordList = searchKeywords.split(",").map(k => k.trim().toLowerCase()).filter(k => k);
               const titleLower = title.toLowerCase();
               // More lenient matching: if any keyword is in title or text
               matchesKeywords = keywordList.some(k => pageText.includes(k) || titleLower.includes(k));
            }

            if (matchesKeywords) {
                 console.log(`[Job ${jobId}] Found match: ${request.url}`);
                 const extractedData: any = {
                    url: request.url,
                    title,
                    type: "gathered",
                    timestamp: new Date().toISOString(),
                 };

                 // Extraction logic
                 if (normalizedSelectors.includes("headings")) {
                    extractedData.headings = $("h1, h2, h3").map((i, el) => $(el).text().trim()).get().filter(t => t.length > 2);
                 }
                 if (normalizedSelectors.includes("text")) {
                    extractedData.text = $("p").map((i, el) => $(el).text().trim()).get().filter(t => t.length > 20).slice(0, 10);
                 }
                 if (normalizedSelectors.includes("meta")) {
                    extractedData.meta = {
                      description: $('meta[name="description"]').attr("content"),
                      keywords: $('meta[name="keywords"]').attr("content"),
                    };
                 }
                 if (normalizedSelectors.includes("images")) {
                    extractedData.images = $("img").map((i, el) => ({
                      src: $(el).attr("src"),
                      alt: $(el).attr("alt"),
                    })).get().filter(img => img.src && img.src.startsWith('http')).slice(0, 10);
                 }
                 if (normalizedSelectors.includes("links")) {
                     extractedData.links = $("a").map((i, el) => $(el).attr("href")).get().filter(l => l && l.startsWith('http')).slice(0, 20);
                 }

                 if (emittedCount < targetLimit) {
                    io.emit(`crawl-data-${jobId}`, extractedData);
                    emittedCount++;
                 }
            }
        }

        // Enqueue links
        if (isDDG) {
            // DuckDuckGo HTML version uses different selectors
            const links = $('.result__a').map((i, el) => $(el).attr('href')).get();
            const fallbackLinks = $('.result__title a').map((i, el) => $(el).attr('href')).get();
            const allLinks = [...new Set([...links, ...fallbackLinks])];
            
            console.log(`[Job ${jobId}] Found ${allLinks.length} links on DDG`);
            
            for (let link of allLinks) {
                if (link.startsWith('/l/')) {
                    try {
                        const urlObj = new URL(link, 'https://duckduckgo.com');
                        const actualUrl = urlObj.searchParams.get('uddg');
                        if (actualUrl) link = actualUrl;
                    } catch (e) {}
                }

                if (link.startsWith('http') && !link.includes('duckduckgo.com')) {
                    await enqueueLinks({
                        urls: [link],
                        label: 'DETAIL',
                    });
                }
            }
        }
      },
    });

    activeCrawlers.set(jobId, crawler);
    await crawler.run(searchUrls);
    activeCrawlers.delete(jobId);
    io.emit(`crawl-complete-${jobId}`, { status: "completed" });

  } catch (error) {
    console.error("Gatherer error:", error);
    io.emit(`crawl-error-${jobId}`, { error: error.message });
  }
}

startServer();
