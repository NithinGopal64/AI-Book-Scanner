import axios from 'axios';

// Google Books API lookup - primary source for rich metadata
// Note: Google Books API doesn't require an API key
export async function lookupGoogleBooks(q, { limit = 3 } = {}) {
  try {
    let url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${limit}`;
    // Optionally add API key if provided (for higher rate limits)
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    if (apiKey) {
      url += `&key=${encodeURIComponent(apiKey)}`;
    }
    const { data } = await axios.get(url);
    const items = data?.items || [];
    return items.map((item) => {
      const volumeInfo = item.volumeInfo || {};
      const industryIdentifiers = volumeInfo.industryIdentifiers || [];
      
      // Extract ISBNs
      const isbn13 = industryIdentifiers.find((id) => id.type === 'ISBN_13')?.identifier;
      const isbn10 = industryIdentifiers.find((id) => id.type === 'ISBN_10')?.identifier;
      
      // Extract publication year
      const publishedDate = volumeInfo.publishedDate || '';
      const publicationYear = publishedDate ? parseInt(publishedDate.split('-')[0]) : null;
      
      // Extract series information from title or categories
      const seriesMatch = volumeInfo.title?.match(/(.+?)\s*\((.+?)\s*#(\d+)\)/i) || 
                       volumeInfo.subtitle?.match(/(.+?)\s*#(\d+)/i);
      const seriesName = seriesMatch ? seriesMatch[1] : 
                        (volumeInfo.categories?.find((cat) => cat.toLowerCase().includes('series')) || null);
      const seriesNumber = seriesMatch ? parseInt(seriesMatch[seriesMatch.length - 1]) : null;
      
      return {
        title: volumeInfo.title,
        authors: volumeInfo.authors || [],
        categories: volumeInfo.categories || [],
        genre: volumeInfo.categories || [], // Use categories as genre
        description: volumeInfo.description || '',
        series: {
          name: seriesName,
          number: seriesNumber,
        },
        publicationYear,
        pageCount: volumeInfo.pageCount || null,
        publisher: volumeInfo.publisher || null,
        language: volumeInfo.language || null,
        isbn10: isbn10 || null,
        isbn13: isbn13 || null,
        thumbnail: volumeInfo.imageLinks?.thumbnail || 
                  volumeInfo.imageLinks?.smallThumbnail || 
                  null,
        advancedMetadata: {
          averageRating: volumeInfo.averageRating || null,
          ratingsCount: volumeInfo.ratingsCount || null,
          maturityRating: volumeInfo.maturityRating || null,
          printType: volumeInfo.printType || null,
          previewLink: volumeInfo.previewLink || null,
          infoLink: volumeInfo.infoLink || null,
          canonicalVolumeLink: volumeInfo.canonicalVolumeLink || null,
          subtitle: volumeInfo.subtitle || null,
          publishedDate: publishedDate || null,
          industryIdentifiers: industryIdentifiers.map((id) => ({
            identifierType: id.type, 
            identifier: id.identifier,
          })),
          dimensions: volumeInfo.dimensions || null,
          mainCategory: volumeInfo.mainCategory || null,
          contentVersion: volumeInfo.contentVersion || null,
          imageLinks: volumeInfo.imageLinks || null,
        },
        source: 'googlebooks',
      };
    });
  } catch (error) {
    console.error('Google Books API error:', error.message);
    return [];
  }
}

// Open Library lookup - fallback
function mapDocToMeta(d) {
  const publishedYear = d.first_publish_year || 
                       (d.publish_date ? parseInt(d.publish_date[0]?.split('-')[0]) : null);
  
  return {
    title: d.title,
    authors: d.author_name || [],
    categories: d.subject ? d.subject.slice(0, 5) : [],
    genre: d.subject ? d.subject.slice(0, 5) : [],
    description: '',
    series: {
      name: null,
      number: null,
    },
    publicationYear: publishedYear,
    pageCount: d.number_of_pages_median || null,
    publisher: d.publisher?.[0] || null,
    isbn10: (d.isbn || []).find((x) => String(x).length === 10),
    isbn13: (d.isbn || []).find((x) => String(x).length === 13),
    thumbnail: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    language: d.language?.[0] || null,
    advancedMetadata: {},
    source: 'openlibrary',
  };
}

export async function lookupOpenLibrary(q, { limit = 3 } = {}) {
  try {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}`;
  const { data } = await axios.get(url);
  const docs = data?.docs || [];
  return docs.map(mapDocToMeta);
  } catch (error) {
    console.error('Open Library API error:', error.message);
    return [];
  }
}

// Primary lookup function - tries Google Books first, falls back to Open Library
export async function lookupBookMetadata(q, { limit = 3 } = {}) {
  // Try Google Books first (richer metadata)
  const googleResults = await lookupGoogleBooks(q, { limit });
  if (googleResults.length > 0) {
    return googleResults;
  }
  
  // Fallback to Open Library
  const openLibResults = await lookupOpenLibrary(q, { limit });
  return openLibResults;
}

const normalize = (title) => String(title || '').trim().toLowerCase();

export async function lookupSimilarBooks(seedMeta = {}, { limit = 4 } = {}) {
  const seenTitles = new Set();
  const pushSeed = (t) => { const key = normalize(t); if (key) seenTitles.add(key); };
  pushSeed(seedMeta.title);
  (seedMeta.aliases || []).forEach(pushSeed);

  const hints = [];
  if (seedMeta.authors?.length) hints.push(seedMeta.authors[0]);
  if (seedMeta.genre?.length) hints.push(seedMeta.genre[0]);
  if (seedMeta.categories?.length) hints.push(seedMeta.categories[0]);
  if (seedMeta.title) hints.push(seedMeta.title);
  if (!hints.length && seedMeta.isbn13) hints.push(seedMeta.isbn13);

  const recs = [];
  for (const hint of hints) {
    if (!hint) continue;
    const metas = await lookupBookMetadata(hint, { limit: Math.max(limit * 2, 3) });
    for (const meta of metas) {
      const key = normalize(meta.title);
      if (!key || seenTitles.has(key)) continue;
      seenTitles.add(key);
      recs.push(meta);
      if (recs.length >= limit) return recs;
    }
  }
  return recs;
}
