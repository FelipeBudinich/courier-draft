export const renderTodoPage = (res, locals = {}, statusCode = 200) =>
  res.status(statusCode).render('pages/todo-page.njk', locals);

