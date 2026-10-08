import { Hono } from 'hono'
import * as productsController from './products.controller.js'
import { optionalAuthMiddleware } from '../../middlewares/auth.js'

const productRoutes = new Hono<{ Variables: { user: any } }>()

productRoutes.get('/', productsController.getAllProducts)
productRoutes.get('/categories', productsController.getCategories)
productRoutes.get('/:id', productsController.getProductById)

export default productRoutes
    