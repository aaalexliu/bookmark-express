const fs = require('fs').promises;
const SQL = require('sql-template-strings');
const path = require('path');
const db = require('./db');

const tempDataFile = path.resolve(__dirname, './bookmarker.sql');

/* sql-template strings example
// postgres:
pg.query('SELECT author FROM books WHERE name = $1 AND author = $2', [book, author])
// is equivalent to
pg.query(SQL`SELECT author FROM books WHERE name = ${book} AND author = ${author}`)
*/

// async function initializeBooksDB() {
//   const queryString = await fs.readFile(tempDataFile, 'utf-8');
//   // console.log('boo');
//   const res = await db.query(queryString);
//   console.log(res);
// }

// async function dropBooksDB() {
//   const query = `DROP TABLE books, goodreads_details, kindle_annotations,
//   calibre_authors, calibre_authors_books, calibre_metadata
//   `;
//   const res = await db.query(query);
//   console.log(res);
// }


async function createBookWithCalibre(calibreMetaData) {
  const {
    identifiers, title, author_sort_map,
  } = calibreMetaData;

  const { isbn } = identifiers;


  try {
    const authorIDs = await Promise.all(Object.keys(author_sort_map).map((author) => insertCalibreAuthor(author, author_sort_map[author])));

    const bookID = await insertBook(title, isbn);
    const calibreID = await insertCalibreMetadata(calibreMetaData);
    const res = await Promise.all(
      authorIDs.map((authorID) => insertAuthorIDBookID(authorID, calibreID)),
    );
    return calibreID;
  } catch (err) {
    console.log(err);
    throw (err);
  }
}

async function insertBook(title, isbn) {
  const { rows } = await db.query(SQL`
  INSERT INTO books
    (title, completed_bool, isbn)
  VALUES
    (${title}, false, ${isbn})
  ON CONFLICT (title)
  DO UPDATE SET title = EXCLUDED.title
  RETURNING id;
  `);
  return rows[0].id;
}

async function insertCalibreAuthor(author, author_sort) {
  const { rows } = await db.query(SQL`
  INSERT INTO calibre_authors
    (author, author_sort)
  VALUES
    (${author}, ${author_sort})
  ON CONFLICT (author)
  DO UPDATE SET author = EXCLUDED.author
  RETURNING id;
  `);
  return rows[0].id;
}

async function insertCalibreMetadata(calibreMetaData) {
  let {
    identifiers, cover, title, series, publisher,
    pubdate, title_sort, comments,
  } = calibreMetaData;

  pubdate = pubdate.split('T')[0];

  const { isbn, amazon } = identifiers;

  const { rows } = await db.query(SQL`
  INSERT INTO calibre_metadata
    (isbn, amazon, title, series, publisher, pubdate, title_sort, comments, cover)
  VALUES
    (${isbn}, ${amazon}, ${title}, ${series}, ${publisher}, ${pubdate},
      ${title_sort}, ${comments}, ${cover})
  ON CONFLICT (isbn)
  DO UPDATE SET isbn = EXCLUDED.isbn
  RETURNING id;
  `);

  return rows[0].id;
}


async function insertAuthorIDBookID(authorID, bookID) {
  const { rows } = await db.query(SQL`
  INSERT INTO calibre_authors_books (author_id, book_id)
  VALUES (${authorID}, ${bookID})
  ON CONFLICT (author_id, book_id)
  DO UPDATE SET book_id = EXCLUDED.book_id
  RETURNING author_id, book_id;
  `);
  return rows[0].id;
}

async function linkBookToAuthor(isbn, author) {
  const res = await db.query(SQL`
  INSERT INTO calibre_authors_books (author_id, book_id)
  VALUES 
    ((
      SELECT id FROM calibre_authors WHERE
      author = ${author}
    ),
    (
      SELECT id FROM calibre_metadata WHERE
      isbn = ${isbn}
    ))
  `);

  return res;
}


async function createBookWithGoodreads(book) {
  const {
    id, title, isbn13, kindle_asin, marketplace_id, image_url, language_code,
    publisher, publication_year, publication_month, publication_day, is_ebook,
    description,
  } = book;

  try {
    const res = await db.query(SQL`
    INSERT INTO goodreads_details
      (id, title, isbn13, kindle_asin, marketplace_id, image_url, language_code,
        publisher, publication_year, publication_month, publication_day, is_ebook,
        description)
      VALUES
      (${id}, ${title}, ${isbn13}, ${kindle_asin}, ${marketplace_id}, ${image_url},
        ${language_code}, ${publisher}, ${publication_year}, ${publication_month}, ${publication_day},
        ${is_ebook}, ${description})
    `);

    const res2 = await insertBook(title, isbn);
    const res3 = await linkGoodreads(isbn);
    return { res, res2, res3 };
  } catch (err) {
    console.log(err);
  }
}

async function linkGoodreads() {
  const res = await db.query(SQL`
  UPDATE
    books
  SET
    a.goodreads_details_id = b.id,
  FROM
    books AS a
    INNER JOIN goodreads_details AS b
      ON a.isbn = b.isbn
  WHERE
    a.isbn = ${isbn} AND
    b.isbn = ${isbn}
  `);

  return res;
}

async function getBookDetails(book_id) {
  const { rows } = await db.query(SQL`
    SELECT a.id, a.title, a.completed_bool, a.isbn, b.publisher, 
    TO_CHAR(b.pubdate, 'yyyy-mm-dd') AS pubdate, b.comments AS description, b.series
    FROM books AS a
    LEFT JOIN  calibre_metadata AS b ON a.isbn = b.isbn
    LEFT JOIN goodreads_details AS c ON a.isbn = c.isbn13
    WHERE a.id = ${book_id}
  `);

  return rows[0];
}

async function getAllBookDetails(limit = 50) {
  const { rows } = await db.query(SQL`
    SELECT a.id, a.title, a.completed_bool, a.isbn, b.publisher, 
    TO_CHAR(b.pubdate, 'yyyy-mm-dd') AS pubdate, b.comments AS description, b.series
    FROM books AS a
    LEFT JOIN  calibre_metadata AS b ON a.isbn = b.isbn
    LEFT JOIN goodreads_details AS c ON a.isbn = c.isbn13
    LIMIT ${limit}
  `);

  return rows;
}

async function getBookID(title) {
  const { rows } = await db.query(SQL`
    SELECT id FROM books WHERE title = ${title}
  `);

  if (!rows[0]) return null;

  return rows[0].id;
}

// debugger;

// async function testInsertAuthor(author_sort_map) {
//   const authorIDs = await Promise.all(Object.keys(author_sort_map).map( author => {
//     return insertCalibreAuthor(author, author_sort_map[author]);
//   }));
//   console.log(authorIDs);
//   return authorIDs;
// }
// let ids;
// testInsertAuthor({'bob':'bob', 'bob1':'bob1'}).then(authors => ids = authors);

// insertCalibreAuthor('bob');

// let data = getBookDetails(82120);
// getBookDetails('How to ')

module.exports = {
  // initializeBooksDB,
  createBookWithGoodreads,
  // dropBooksDB,
  getBookDetails,
  getAllBookDetails,
  createBookWithCalibre,
  getBookID,
  insertBook,
};

/* error object
err: error: duplicate key value violates unique constraint "calibre_authors_author_key" at Connection.parseE (/Users/Alex/projects/bookmarker-express/node_modules/pg/lib/connection.js:600:48) at Connection.parseMessage (/Users/Alex/projects/bookmarker-express/node_modules/pg/lib/connection.js:399:19) at Socket.<anonymous> (/Users/Alex/projects/bookmarker-express/node_modules/pg/lib/connection.js:115:22) at Socket.emit (events.js:200:13) at addChunk (_stream_readable.js:294:12) at readableAddChunk (_stream_readable.js:275:11) at Socket.Readable.push (_stream_readable.js:210:10) at TCP.onStreamRead (internal/stream_base_commons.js:166:17)
code: "23505"
column: undefined
constraint: "calibre_authors_author_key"
dataType: undefined
detail: "Key (author)=(Stephen King) already exists."
file: "nbtinsert.c"
hint: undefined
internalPosition: undefined
internalQuery: undefined
length: 237
line: "570"
name: "error"
position: undefined
routine: "_bt_check_unique"
schema: "public"
severity: "ERROR"
table: "calibre_authors"
where: undefined
message: "duplicate key value violates unique constraint "calibre_authors_author_key""
stack: "error: duplicate key value violates unique constraint "calibre_authors_author_key"↵    at Connection.parseE (/Users/Alex/projects/bookmarker-express/node_modules/pg/lib/connection.js:600:48)↵    at Connection.parseMessage (/Users/Alex/projects/bookmarker-express/node_modules/pg/lib/connection.js:399:19)↵    at Socket.<anonymous> (/Users/Alex/projects/bookmarker-express/node_modules/pg/lib/connection.js:115:22)↵    at Socket.emit (events.js:200:13)↵    at addChunk (_stream_readable.js:294:12)↵    at readableAddChunk (_stream_readable.js:275:11)↵    at Socket.Readable.push (_stream_readable.js:210:10)↵    at TCP.onStreamRead (internal/stream_base_commons.js:166:17)"
__proto__: Object
*/
