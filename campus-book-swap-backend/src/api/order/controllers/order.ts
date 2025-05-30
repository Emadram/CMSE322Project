/**
 * order controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async create(ctx) {
    // @ts-ignore
    const { items, ...orderData } = ctx.request.body.data;
    const buyerId = ctx.state.user?.id;

    if (!buyerId) {
      return ctx.badRequest('Buyer information is missing.');
    }

    const response = await super.create(ctx);

    if (response.data && items && Array.isArray(items)) {
      for (const item of items) {
        try {
          const book = await strapi.entityService.findOne('api::book.book', item.bookId, {
            populate: ['seller', 'users_permissions_user'],
          });

          if (!book) {
            strapi.log.warn(`Book with ID ${item.bookId} not found during order creation.`);
            continue;
          }
          // @ts-ignore
          const sellerId = book.seller?.id || book.users_permissions_user?.id;

          if (!sellerId) {
            strapi.log.warn(`Seller ID not found for book ID ${item.bookId}.`);
            continue;
          }

          await strapi.entityService.update('api::book.book', item.bookId, {
            data: {
              status: 'sold',
            },
          });

          await strapi.entityService.create('api::transaction.transaction', {
            data: {
              book: { id: item.bookId },
              users_permissions_user: { id: buyerId },
              seller: { id: sellerId },
              Tstatus: 'completed', // Corrected back to Tstatus
              orderDate: new Date().toISOString(),
              // @ts-ignore
              amount: book.price,
              type: 'sale',
              publishedAt: new Date().toISOString(),
            },
          });

        } catch (error) {
          strapi.log.error(`Failed to process book ID ${item.bookId} during order creation:`, error);
        }
      }
    }
    return response;
  },

  async update(ctx) {
    const response = await super.update(ctx);
    // @ts-ignore
    const orderId = ctx.params.id;
    // @ts-ignore
    const { status } = ctx.request.body.data; // This is the new status of the order itself

    if (status === 'completed' && response.data) {
      // Fetch the order again to get its current state, including the JSON 'items' field
      const updatedOrder = await strapi.entityService.findOne('api::order.order', orderId);

      if (!updatedOrder) {
        strapi.log.error(`Order with ID ${orderId} not found after update.`);
        return response;
      }
      
      // @ts-ignore
      const orderItems = updatedOrder.items; // 'items' is a JSON field on the order
      // @ts-ignore
      const buyerId = updatedOrder.userId; // 'userId' is a string field on the order

      if (!buyerId) {
        strapi.log.error(`Buyer ID (userId) not found for order ${orderId} during update.`);
        return response;
      }

      if (orderItems && Array.isArray(orderItems)) {
        for (const item of orderItems) {
          // @ts-ignore
          const bookId = item.bookId; // Assuming each item in the JSON array has a bookId

          if (!bookId) {
            strapi.log.warn(`Book ID missing for an item in order ${orderId} during update.`);
            continue;
          }

          try {
            // Fetch the book details separately since 'items' is JSON
            const bookEntry = await strapi.entityService.findOne('api::book.book', bookId, {
              populate: ['seller', 'users_permissions_user'], // Populate seller fields on the book
            });

            if (!bookEntry) {
              strapi.log.warn(`Book with ID ${bookId} not found during order update.`);
              continue;
            }
            
            // @ts-ignore
            const sellerId = bookEntry.seller?.id || bookEntry.users_permissions_user?.id;

            if (!sellerId) {
              strapi.log.warn(`Seller ID not found for book ID ${bookId} during order update.`);
              continue;
            }

            await strapi.entityService.update('api::book.book', bookId, {
              data: {
                status: 'sold',
              },
            });
            
            // Check for existing transactions to avoid duplicates
            const existingTransactions = await strapi.entityService.findMany('api::transaction.transaction', {
              filters: {
                book: { id: bookId },
                users_permissions_user: { id: buyerId },
                seller: { id: sellerId },
                type: 'sale',
                // Consider adding order: { id: orderId } if your transaction schema links to orders
              },
            });

            // @ts-ignore
            if (existingTransactions.length === 0) {
              await strapi.entityService.create('api::transaction.transaction', {
                data: {
                  book: { id: bookId },
                  users_permissions_user: { id: buyerId }, // Buyer
                  seller: { id: sellerId },           // Seller
                  Tstatus: 'completed', // Corrected back to Tstatus
                  orderDate: new Date().toISOString(),
                  // @ts-ignore
                  amount: bookEntry.price, // Use price from the fetched book
                  type: 'sale', 
                  publishedAt: new Date().toISOString(),
                  // order: { id: orderId }, // If transaction is linked to order
                },
              });
            } else {
              strapi.log.info(`Transaction already exists for book ${bookId} by buyer ${buyerId} from seller ${sellerId}. Skipping creation.`);
            }

          } catch (error) {
            strapi.log.error(`Failed to process book ID ${bookId} during order update for order ${orderId}:`, error);
          }
        }
      }
    }
    return response;
  }
}));
