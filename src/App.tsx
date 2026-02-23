import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import * as d3 from 'd3';
import { Download, Play, Search, Settings, FileText, Image as ImageIcon, Link as LinkIcon, Activity } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

// Utility for tailwind classes
function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: any) => {
  const variants = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/30',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm',
    outline: 'border-2 border-indigo-500 text-indigo-600 hover:bg-indigo-50',
    ghost: 'hover:bg-slate-100 text-slate-600 hover:text-slate-900',
  };
  return (
    <button
      className={cn(
        'px-6 py-3 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 active:scale-95',
        variants[variant],
        className
      )}
      {...props}
    />
  );
};

const Input = ({ className, ...props }: any) => (
  <input
    className={cn(
      'w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all shadow-sm',
      className
    )}
    {...props}
  />
);

const Label = ({ children, className }: any) => (
  <label className={cn('block text-sm font-medium text-slate-700 mb-2 ml-1', className)}>
    {children}
  </label>
);

const Card = ({ children, className }: any) => (
  <div className={cn('bg-white/80 backdrop-blur-xl border border-slate-200 rounded-2xl p-6 shadow-xl shadow-slate-200/50', className)}>
    {children}
  </div>
);

// --- Neural Graph Visualization ---

const NeuralGraph = ({ data }: { data: any[] }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const simulationRef = useRef<any>(null);
  
  // Use refs for nodes/links to avoid React render cycle conflicts with D3
  const nodesRef = useRef<any[]>([]);
  const linksRef = useRef<any[]>([]);

  useEffect(() => {
    if (!data.length) return;
    
    const newItem = data[data.length - 1];
    
    // Avoid duplicates in our local ref
    if (nodesRef.current.some(n => n.url === newItem.url)) return;

    const newNode = { 
      id: newItem.url || Math.random(), 
      group: newItem.type === 'image' ? 2 : 1, 
      ...newItem,
      x: 0, y: 0 
    };
    
    // Add node
    nodesRef.current.push(newNode);
    if (nodesRef.current.length > 100) nodesRef.current.shift();

    // Add link
    if (nodesRef.current.length > 1) {
      // Link to a random existing node (excluding self)
      const targets = nodesRef.current.filter(n => n.id !== newNode.id);
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        linksRef.current.push({ source: newNode.id, target: target.id });
        if (linksRef.current.length > 100) linksRef.current.shift();
      }
    }

    updateGraph();
  }, [data]);

  const updateGraph = () => {
    if (!svgRef.current) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Initialize simulation if needed
    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation()
        .force("charge", d3.forceManyBody().strength(-100))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(10));
        
      // Setup zoom once
      const svg = d3.select(svgRef.current);
      const g = svg.append("g");
      g.attr("class", "graph-container");
      
      const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
          transformRef.current = event.transform;
        });

      svg.call(zoom as any)
         .call(zoom.transform as any, transformRef.current);
         
      // Append groups for links and nodes
      g.append("g").attr("class", "links");
      g.append("g").attr("class", "nodes");
    }

    const simulation = simulationRef.current;
    
    // Clean links
    const nodeIds = new Set(nodesRef.current.map(n => n.id));
    const validLinks = linksRef.current.filter(l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });
    
    // Update simulation data
    simulation.nodes(nodesRef.current);
    simulation.force("link", d3.forceLink(validLinks).id((d: any) => d.id).distance(50));
    simulation.alpha(1).restart();

    // Render loop
    const g = d3.select(svgRef.current).select(".graph-container");
    
    const link = g.select(".links")
      .selectAll("line")
      .data(validLinks)
      .join("line")
      .attr("stroke", "#6366f1")
      .attr("stroke-opacity", 0.3)
      .attr("stroke-width", 1);

    const node = g.select(".nodes")
      .selectAll("circle")
      .data(nodesRef.current, (d: any) => d.id)
      .join("circle")
      .attr("r", 5)
      .attr("fill", (d: any) => d.group === 1 ? "#4f46e5" : "#ec4899")
      .call(d3.drag()
        .on("start", (event, d: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d: any) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d: any) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }) as any);

    node.select("title").remove(); // Remove old titles
    node.append("title").text((d: any) => d.url);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node
        .attr("cx", (d: any) => d.x)
        .attr("cy", (d: any) => d.y);
    });
  };

  useEffect(() => {
    // Initial setup
    updateGraph();
    
    return () => {
      if (simulationRef.current) simulationRef.current.stop();
    };
  }, []);

  return (
    <svg ref={svgRef} className="w-full h-full bg-slate-50 rounded-2xl border border-slate-200 shadow-inner" />
  );
};

// --- Main App ---

export default function App() {
  const [view, setView] = useState<'home' | 'config' | 'results'>('home');
  const [mode, setMode] = useState<'site' | 'gather'>('site');
  const [crawling, setCrawling] = useState(false);
  const [extractedData, setExtractedData] = useState<any[]>([]);
  const [socket, setSocket] = useState<any>(null);
  
  // Form States
  const [url, setUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const [limit, setLimit] = useState('200');
  const [selectedSelectors, setSelectedSelectors] = useState<string[]>(['text', 'headings', 'meta', 'images', 'links']);
  const [topic, setTopic] = useState('');
  const [activeResultTab, setActiveResultTab] = useState<'text' | 'images' | 'headings' | 'links'>('text');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const selectorOptions = [
    { id: 'text', label: 'Text Content' },
    { id: 'headings', label: 'Headings' },
    { id: 'meta', label: 'Meta Tags' },
    { id: 'images', label: 'Images' },
    { id: 'links', label: 'Links' },
  ];

  const toggleSelector = (id: string) => {
    setSelectedSelectors(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };
  
  const uniqueImages = React.useMemo(() => {
    const map = new Map();
    extractedData.forEach(item => {
      if (item.images) {
        item.images.forEach((img: any) => {
          if (img.src && !map.has(img.src)) {
            map.set(img.src, img);
          }
        });
      }
    });
    return Array.from(map.values());
  }, [extractedData]);

  const uniqueLinks = React.useMemo(() => {
    const set = new Set<string>();
    extractedData.forEach(d => {
      if (d.links) d.links.forEach((l: string) => {
        if (l) set.add(l);
      });
    });
    return Array.from(set);
  }, [extractedData]);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);
    return () => { 
      if (activeJobId) {
        newSocket.off(`crawl-data-${activeJobId}`);
        newSocket.off(`crawl-complete-${activeJobId}`);
        newSocket.off(`crawl-error-${activeJobId}`);
      }
      newSocket.close(); 
    };
  }, [activeJobId]);

  const startCrawl = async () => {
    if (mode === 'site' && !url) return;
    if (mode === 'gather' && !topic) return;
    
    // Stop any active job and clean up listeners
    if (activeJobId && socket) {
      socket.emit('stop-crawl', { jobId: activeJobId });
      socket.off(`crawl-data-${activeJobId}`);
      socket.off(`crawl-complete-${activeJobId}`);
      socket.off(`crawl-error-${activeJobId}`);
    }

    setCrawling(true);
    setExtractedData([]); // Clear previous data
    setView('results'); // Switch to results view immediately
    setStatusMessage('Initializing...');
    
    // Use selected selectors
    const selectors = selectedSelectors;

    if (mode === 'site') {
      const response = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, keywords, limit, selectors }),
      });
      const { jobId } = await response.json();
      setActiveJobId(jobId);
      
      const dataHandler = (data: any) => {
        setStatusMessage(`Extracting from: ${data.url.substring(0, 50)}...`);
        setExtractedData(prev => {
          if (prev.some((item: any) => item.url === data.url)) return prev;
          return [...prev, data];
        });
      };

      const completeHandler = () => {
        setCrawling(false);
        setStatusMessage('Crawl completed successfully.');
      };

      const errorHandler = (data: any) => {
        console.error("Crawl error:", data);
        setCrawling(false);
        setStatusMessage(`Error: ${data.error}`);
      };

      socket.on(`crawl-data-${jobId}`, dataHandler);
      socket.on(`crawl-complete-${jobId}`, completeHandler);
      socket.on(`crawl-error-${jobId}`, errorHandler);
    } else {
      // Gather mode
      setStatusMessage('Preparing search query...');
      const response = await fetch('/api/gather', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, keywords, limit, selectors }),
      });
      const { jobId } = await response.json();
      setActiveJobId(jobId);
       
      const dataHandler = (data: any) => {
        setStatusMessage(`Found: ${data.title || data.url.substring(0, 30)}`);
        setExtractedData(prev => {
          if (prev.some((item: any) => item.url === data.url)) return prev;
          return [...prev, data];
        });
      };

      const completeHandler = () => {
        setCrawling(false);
        setStatusMessage('Gathering completed.');
      };

      const errorHandler = (data: any) => {
        console.error("Gather error:", data);
        setCrawling(false);
        setStatusMessage(`Error: ${data.error}`);
      };

      socket.on(`crawl-data-${jobId}`, dataHandler);
      socket.on(`crawl-complete-${jobId}`, completeHandler);
      socket.on(`crawl-error-${jobId}`, errorHandler);
    }
  };

  const stopCrawl = () => {
    if (activeJobId && socket) {
      socket.emit('stop-crawl', { jobId: activeJobId });
      setCrawling(false);
      setStatusMessage('Stopped by user.');
    }
  };

  const downloadData = async (format: 'json' | 'csv' | 'xls' | 'zip') => {
    if (format === 'json') {
      const dataStr = JSON.stringify(extractedData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      saveAs(blob, 'crawl_data.json');
    } else if (format === 'csv') {
      const headers = Object.keys(extractedData[0] || {}).join(',');
      const rows = extractedData.map(d => Object.values(d).map(v => `"${v}"`).join(',')).join('\n');
      const blob = new Blob([`${headers}\n${rows}`], { type: 'text/csv' });
      saveAs(blob, 'crawl_data.csv');
    } else if (format === 'xls') {
      const ws = XLSX.utils.json_to_sheet(extractedData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Data");
      XLSX.writeFile(wb, "crawl_data.xlsx");
    } else if (format === 'zip') {
      const zip = new JSZip();
      zip.file("data.json", JSON.stringify(extractedData, null, 2));
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, "crawl_data.zip");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-500/30">
      <AnimatePresence mode="wait">
        {view === 'home' ? (
          <motion.div 
            key="home"
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center justify-center min-h-screen p-8 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-100 via-slate-50 to-slate-50 pointer-events-none" />
            
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="z-10 text-center max-w-3xl"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-sm mb-6 shadow-sm">
                <Activity className="w-4 h-4" />
                <span>Next-Gen Web Spider</span>
              </div>
              <h1 className="text-6xl md:text-7xl font-bold tracking-tight text-slate-900 mb-6">
                Extract the Web <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-cyan-600">
                  Intelligently
                </span>
              </h1>
              <p className="text-xl text-slate-600 mb-10 leading-relaxed">
                A powerful, neural-network visualized crawler built on Crawlee. 
                Gather data, analyze trends, and visualize the web in real-time.
              </p>
              
              <div className="flex gap-4 justify-center">
                <Button onClick={() => setView('config')} className="text-lg px-8 py-4 shadow-xl shadow-indigo-500/20">
                  Launch Spider <Play className="w-5 h-5" />
                </Button>
                <Button variant="secondary" className="text-lg px-8 py-4 bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-lg shadow-slate-200/50">
                  Learn More
                </Button>
              </div>
            </motion.div>
            
            {/* Decorative Grid */}
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-40 pointer-events-none mix-blend-overlay"></div>
          </motion.div>
        ) : view === 'config' ? (
          <motion.div 
            key="config"
            initial={{ opacity: 0, x: 20 }} 
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="min-h-screen flex flex-col items-center justify-center p-6"
          >
             <div className="max-w-4xl w-full space-y-8">
               <div className="text-center">
                 <h2 className="text-3xl font-bold text-slate-900 mb-2">Configure Extraction</h2>
                 <p className="text-slate-500">Select your mode and define parameters.</p>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <button 
                   onClick={() => setMode('site')}
                   className={cn(
                     "p-6 rounded-2xl border-2 text-left transition-all hover:scale-[1.02] shadow-sm",
                     mode === 'site' 
                       ? "bg-indigo-50 border-indigo-500 shadow-lg shadow-indigo-500/10" 
                       : "bg-white border-slate-200 hover:border-slate-300"
                   )}
                 >
                   <div className="bg-indigo-100 w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-indigo-600">
                     <LinkIcon className="w-6 h-6" />
                   </div>
                   <h3 className="text-xl font-bold text-slate-900 mb-2">Main Crawler</h3>
                   <p className="text-sm text-slate-500">Target a specific URL and crawl recursively to extract structured data.</p>
                 </button>

                 <button 
                   onClick={() => setMode('gather')}
                   className={cn(
                     "p-6 rounded-2xl border-2 text-left transition-all hover:scale-[1.02] shadow-sm",
                     mode === 'gather' 
                       ? "bg-pink-50 border-pink-500 shadow-lg shadow-pink-500/10" 
                       : "bg-white border-slate-200 hover:border-slate-300"
                   )}
                 >
                   <div className="bg-pink-100 w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-pink-500">
                     <Search className="w-6 h-6" />
                   </div>
                   <h3 className="text-xl font-bold text-slate-900 mb-2">Universal Mode</h3>
                   <p className="text-sm text-slate-500">Gather data based on topics or keywords from across the web.</p>
                 </button>
               </div>

               <Card className="p-8">
                 <div className="space-y-6">
                    {mode === 'site' ? (
                      <div>
                        <Label>Target URL</Label>
                        <Input 
                          placeholder="https://example.com" 
                          value={url} 
                          onChange={(e: any) => setUrl(e.target.value)} 
                        />
                      </div>
                    ) : (
                      <div>
                        <Label>Topic</Label>
                        <Input 
                          placeholder="e.g. Artificial Intelligence" 
                          value={topic} 
                          onChange={(e: any) => setTopic(e.target.value)} 
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label>Keywords (Optional)</Label>
                        <Input 
                          placeholder="comma, separated, keywords" 
                          value={keywords} 
                          onChange={(e: any) => setKeywords(e.target.value)} 
                        />
                      </div>
                      <div>
                        <Label>Limit Items</Label>
                        <Input 
                          type="number"
                          placeholder="e.g. 200"
                          value={limit}
                          onChange={(e: any) => setLimit(e.target.value)}
                          min="1"
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Data Types to Extract</Label>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
                        {selectorOptions.map((option) => (
                          <label 
                            key={option.id} 
                            className={cn(
                              "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all shadow-sm",
                              selectedSelectors.includes(option.id) 
                                ? "bg-indigo-50 border-indigo-500 text-indigo-700" 
                                : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                            )}
                          >
                            <div className={cn(
                              "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                              selectedSelectors.includes(option.id)
                                ? "bg-indigo-500 border-indigo-500"
                                : "border-slate-300 bg-slate-50"
                            )}>
                              {selectedSelectors.includes(option.id) && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                            </div>
                            <input 
                              type="checkbox" 
                              className="hidden" 
                              checked={selectedSelectors.includes(option.id)}
                              onChange={() => toggleSelector(option.id)}
                            />
                            <span className="text-sm font-medium">{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-4 pt-4">
                      <Button variant="secondary" onClick={() => setView('home')} className="flex-1">
                        Back
                      </Button>
                      <Button onClick={startCrawl} className="flex-[2]">
                        Start Extraction <Play className="w-4 h-4" />
                      </Button>
                    </div>
                 </div>
               </Card>
             </div>
          </motion.div>
        ) : (
          <motion.div 
            key="results"
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }}
            className="min-h-screen flex flex-col"
          >
            {/* Header */}
            <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
              <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-xl text-slate-900 cursor-pointer" onClick={() => setView('home')}>
                  <Activity className="text-indigo-600" />
                  Spider<span className="text-slate-400">UI</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs font-mono text-slate-400 uppercase tracking-widest">Extracted Items</p>
                    <p className="text-sm font-bold text-slate-900">{extractedData.length}</p>
                  </div>
                  <div className="flex gap-1">
                      <Button variant="outline" className="py-1 px-3 text-xs h-8" onClick={() => downloadData('json')}>JSON</Button>
                      <Button variant="outline" className="py-1 px-3 text-xs h-8" onClick={() => downloadData('csv')}>CSV</Button>
                      <Button variant="outline" className="py-1 px-3 text-xs h-8" onClick={() => downloadData('xls')}>XLS</Button>
                      <Button variant="outline" className="py-1 px-3 text-xs h-8" onClick={() => downloadData('zip')}>ZIP</Button>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setExtractedData([])} className="text-xs h-8">
                    Clear
                  </Button>
                  {crawling && (
                    <Button variant="outline" size="sm" onClick={stopCrawl} className="text-xs h-8 text-red-500 border-red-100 hover:bg-red-50">
                      Stop
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setView('config')} className="text-sm">
                    New Search
                  </Button>
                </div>
              </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 max-w-7xl mx-auto w-full p-6 flex flex-col gap-6">
              
              {/* Top: Neural Graph */}
              <div className="w-full h-[400px]">
                <Card className="h-full relative overflow-hidden p-0 border-slate-200 shadow-lg">
                  <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
                    <div className="bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold text-indigo-600 border border-indigo-100 shadow-sm uppercase tracking-wider">
                      LIVE NEURAL FEED
                    </div>
                    {statusMessage && (
                      <div className="bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-medium text-slate-500 border border-slate-100 shadow-sm italic">
                        {statusMessage}
                      </div>
                    )}
                  </div>
                  <NeuralGraph data={extractedData} />
                </Card>
              </div>

              {/* Bottom: Results Section with Menu */}
              <div className="flex flex-col gap-6">
                {/* Menu Bar */}
                <div className="flex border-b border-slate-200">
                  {['text', 'images', 'headings', 'links'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveResultTab(tab as any)}
                      className={cn(
                        "px-6 py-3 text-sm font-medium transition-all capitalize border-b-2",
                        activeResultTab === tab 
                          ? "border-indigo-500 text-indigo-600" 
                          : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Content Area */}
                <div className="min-h-[400px]">
                  {activeResultTab === 'text' && (
                    <Card className="flex flex-col h-full">
                      <div className="flex items-center gap-2 mb-4">
                        <FileText className="w-5 h-5 text-indigo-500" />
                        <h3 className="font-semibold text-slate-900">Text Content</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {extractedData.filter(d => d.text && d.text.length).map((item, i) => (
                          <div key={i} className="bg-slate-50 p-4 rounded-lg border border-slate-200 hover:border-indigo-500/30 transition-colors shadow-sm">
                            <div className="text-xs text-indigo-500 mb-2 truncate" title={item.url}>{item.url}</div>
                            <p className="text-sm text-slate-600 line-clamp-4">{item.text.join(' ')}</p>
                          </div>
                        ))}
                        {extractedData.filter(d => d.text && d.text.length).length === 0 && (
                          <div className="col-span-full text-center text-slate-400 py-12">No text data extracted yet</div>
                        )}
                      </div>
                    </Card>
                  )}

                  {activeResultTab === 'images' && (
                    <Card className="flex flex-col h-full">
                      <div className="flex items-center gap-2 mb-4">
                        <ImageIcon className="w-5 h-5 text-pink-500" />
                        <h3 className="font-semibold text-slate-900">Images Gallery</h3>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                        {uniqueImages.length === 0 ? (
                          <div className="col-span-full text-center text-slate-400 py-12">No images found yet</div>
                        ) : (
                          uniqueImages.map((img: any, i: number) => (
                            <div key={i} className="aspect-square relative group rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
                              <img src={img.src} alt={img.alt} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-2">
                                <span className="text-[10px] text-white text-center truncate w-full">{img.alt || 'No Alt'}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </Card>
                  )}

                  {activeResultTab === 'headings' && (
                    <Card className="flex flex-col h-full">
                      <div className="flex items-center gap-2 mb-4">
                        <Activity className="w-5 h-5 text-emerald-500" />
                        <h3 className="font-semibold text-slate-900">Headings Structure</h3>
                      </div>
                      <div className="space-y-4">
                        {extractedData.filter(d => d.headings && d.headings.length).map((item, i) => (
                          <div key={i} className="bg-slate-50 p-4 rounded-lg border border-slate-200 shadow-sm">
                            <div className="text-xs text-indigo-500 mb-2 truncate">{item.url}</div>
                            <div className="space-y-1 pl-4 border-l-2 border-emerald-500/20">
                              {item.headings.map((h: string, j: number) => (
                                <div key={j} className="text-sm text-slate-600 truncate">{h}</div>
                              ))}
                            </div>
                          </div>
                        ))}
                        {extractedData.filter(d => d.headings && d.headings.length).length === 0 && (
                          <div className="text-center text-slate-400 py-12">No headings found yet</div>
                        )}
                      </div>
                    </Card>
                  )}

                  {activeResultTab === 'links' && (
                    <Card className="flex flex-col h-full">
                      <div className="flex items-center gap-2 mb-4">
                        <LinkIcon className="w-5 h-5 text-cyan-500" />
                        <h3 className="font-semibold text-slate-900">Extracted Links</h3>
                      </div>
                      <div className="space-y-2">
                         {uniqueLinks.length === 0 ? (
                           <div className="text-center text-slate-400 py-12">No links found yet</div>
                         ) : (
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                             {uniqueLinks.map((l: any, i: number) => (
                               <a key={i} href={l} target="_blank" rel="noopener noreferrer" className="block p-3 rounded bg-slate-50 border border-slate-200 text-sm text-cyan-600 hover:text-cyan-700 truncate hover:underline hover:border-cyan-500/30 transition-colors shadow-sm">
                                 {l}
                               </a>
                             ))}
                           </div>
                         )}
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            </main>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
