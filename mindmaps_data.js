// Markdown-based Mindmaps Data Configuration and PlantUML Parser
// Maps topics to .md files and exposes the PlantUML parser to compile tree nodes.

// Mindmaps data placeholders (populated at runtime by app.js from JSON files)
var mindmapFiles = {};
var mindmapNodeDetails = {};

// ==========================================
// PARSING AND COMPILATION LOGIC
// ==========================================

// Parses a complete Markdown file containing a PlantUML @startmindmap code block
function parseMarkdownMindmap(mdText) {
  // Extract Title from first H1 header (# Title)
  const titleMatch = mdText.match(/^#\s+(.*)$/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Mind Map';
  
  // Extract Overview Description (lines between Title and first PlantUML block)
  let description = '';
  const lines = mdText.split('\n');
  let titleFound = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('# ')) {
      titleFound = true;
      continue;
    }
    if (titleFound) {
      if (line.startsWith('```plantuml') || line.startsWith('```puml')) {
        break;
      }
      if (line) {
        description += (description ? ' ' : '') + line;
      }
    }
  }
  
  // Extract PlantUML block content
  const pumlMatch = mdText.match(/```(?:plantuml|puml)\s*([\s\S]*?)```/);
  const pumlText = pumlMatch ? pumlMatch[1] : '';
  
  const rootNode = parsePlantUMLMindmap(pumlText);
  
  // If the parsed root node didn't have a description in details dictionary, use the md overview
  if (rootNode && !rootNode.description) {
    rootNode.description = description;
  }
  
  return {
    title,
    description,
    root: rootNode
  };
}

// Parses PlantUML @startmindmap syntax to return a hierarchical JSON tree
function parsePlantUMLMindmap(pumlText) {
  if (!pumlText) return null;
  
  const lines = pumlText.split('\n');
  const root = { name: '', children: [] };
  const stack = [root]; // Stack to track parent nodes at each depth level
  
  lines.forEach(line => {
    line = line.trim();
    
    // Ignore keywords, headers, and footer lines
    if (!line || 
        line.startsWith('@startmindmap') || 
        line.startsWith('@endmindmap') || 
        line.startsWith('left side') || 
        line.startsWith('right to left') || 
        line.startsWith('top to bottom')) {
      return;
    }
    
    // Regular expression to parse markers (* or + or -), optional inline hex color [#color], and name
    const match = line.match(/^([\*\+\-]+)\s*(?:\[#([a-zA-Z0-9]+)\])?\s*(.*)$/);
    if (match) {
      const markers = match[1];
      const color = match[2];
      let content = match[3].trim();
      
      // Clean content from PlantUML block/Creole styling if present
      if (content.startsWith(':') && content.endsWith(';')) {
        content = content.slice(1, -1);
      } else if (content.startsWith(':')) {
        content = content.slice(1);
      }
      
      const name = content.split('\\n')[0].trim();
      const depth = markers.length;
      
      const node = {
        name: name,
        color: color ? `#${color}` : null,
        children: []
      };
      
      // Enrich node properties from our master details dictionary
      const details = mindmapNodeDetails[name.toLowerCase()];
      if (details) {
        node.description = details.description;
        node.tip = details.tip;
        node.code = details.code;
      }
      
      if (depth === 1) {
        // Set root node values
        root.name = node.name;
        root.color = node.color;
        root.description = node.description || root.description;
        root.tip = node.tip;
        root.code = node.code;
        stack[1] = root;
      } else {
        // Retrieve parent from active depth stack
        const parent = stack[depth - 1];
        if (parent) {
          parent.children.push(node);
          stack[depth] = node;
        } else {
          // Fallback if parent is missing (e.g. indentation mismatch)
          // Connect to root directly
          root.children.push(node);
          stack[depth] = node;
        }
      }
    }
  });
  
  return root;
}
