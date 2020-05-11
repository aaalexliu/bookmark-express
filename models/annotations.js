let db = require('./db');
const fs = require('fs').promises;
const Books = require('./books');

const SQL = require('sql-template-strings');
const path = require('path');
const tempDataFile = path.resolve(__dirname, './bookmarker.sql');

const querySelectCols =  ` 
  book_id, bookline, title, author, language, begin, "end",
  TO_CHAR(time,  'yyyy-mm-dd-hh-mi-ss') AS time, highlight, note , page
  `;

const annosSelectQuery = () => (
  SQL('SELECT' + querySelectCols + ' FROM kindle_annotations')
);

async function getAllAnnotations(limit = 50) {
  const query = annosSelectQuery()
    .append(SQL`LIMIT ${limit}`);

  const {rows} = await db.query(query);
  return rows;
}

async function getAnnotationsByBookTitle(title) {
  const book_id = await getBookID(title);
  const rows = await getAnnotationsByBookID(book_id);
  return rows;
}

async function getAnnotationsByBookID(book_id) {
  const query = annosSelectQuery()
    .append(SQL` WHERE book_id = ${book_id}`);

  const {rows} = await db.query(query);
  return rows;
}

async function getAnnotationByID(annoID) {
  const query = annosSelectQuery()
    .append(SQL` WHERE id = ${annoID}`);

  const {rows} = await db.query(query);

  if (!rows[0]) return null;
  return rows[0];
}
  

/*
kind: 'highlight',
    end: 1080,
    bookline: 'The Worldly Philosophers (Heilbroner, Robert L.)',
    language: 'en',
    author: 'Heilbroner, Robert L.',
    text: 'In a sense the vision of Adam Smith is a testimony to the '
    statusline: 'Your Highlight on Location 1077-1080 | ' +
      'Added on Saturday, February 15, 2020 ' +
      '1:19:41 AM',
    title: 'The Worldly Philosophers',
    begin: 1077,
    time: '2020-02-15 01:19:41',
    ordernr: 8363,
    page: null
  }
*/

async function getMatchingAnnotationID(book_id, begin, end) {
  const {rows} = await db.query(SQL`
  SELECT id FROM kindle_annotations
  WHERE book_id = ${book_id} AND "end" = ${end} AND begin = ${begin}
  `);
  if (!rows[0]) return null;
  return rows[0].id;
}

async function addAnnotation(annotation) {
  const {
    ordernr, kind, bookline, title, author, language, begin, end,
    time, text, statusline, page
  } = annotation;

  let book_id = await Books.getBookID(title);
  if (!book_id) {
    console.log('Could not find pre-existing book to link annotations to');
    book_id = await Books.insertBook(title);
  }

  let id = await getMatchingAnnotationID(book_id, begin, end);
  id = id || ordernr;

  const highlight = kind === 'highlight' ? text : null;
  const note = kind === 'note' ? text : null;

  const query = SQL`
  INSERT INTO kindle_annotations
    (id, book_id, bookline, title, author, language, begin, "end",
      time, highlight, note, statusline, page)
  VALUES
    (${id}, ${book_id}, ${bookline}, ${title}, ${author}, ${language},
      ${begin}, ${end}, ${time}, ${highlight}, ${note}, ${statusline}, ${page}
    )
  ON CONFLICT (id)
  DO UPDATE SET
  statusline = EXCLUDED.statusline, time = EXCLUDED.time`

  if (highlight) query.append(SQL`, highlight = ${highlight}`);
  if (note) query.append(SQL`, note = ${note}`);

  query.append(' RETURNING ' + querySelectCols);

  const {rows} = await db.query(query);

  return rows[0];
}

async function addCalibreAnnotation(calibreAnnotation) {
  const row = await addAnnotation(calibreAnnotation);
  return row;
}

// async function insertNote(annotation) {
//   const {note, statusline, time, book_id, end} = annotation;

//   const {rows} = await db.query(SQL`
//     UPDATE kindle_annotations
//     SET
//       note = ${note},
//       statusline = ${statusline},
//       time = ${time}
//     WHERE
//       book_id = ${book_id} AND "end" = ${end}
//     RETURNING id;
//   `);
//   return rows[0].id;
// }

async function editAnnotation(annotation) {
  const {highlight, note, id} = annotation;

  const { rows } = await db.query(SQL`
    UPDATE kindle_annotations
    SET highlight = ${highlight}, note = ${note}, edited = TRUE
    WHERE id = ${id}
    RETURNING 
  `.append(querySelectCols)
  )
  return rows[0];
}

async function deleteAnnotation(annotation) {
  const {id} = annotation;

  const { rows } = await db.query(SQL`
    DELETE FROM kindle_annotations WHERE id = ${id} RETURNING `
    .append(querySelectCols)
  );

  return rows[0];
}

module.exports = {
  addCalibreAnnotation,
  getAllAnnotations,
  getAnnotationByID,
  getAnnotationsByBookID,
  addAnnotation,
  editAnnotation,
  deleteAnnotation
}