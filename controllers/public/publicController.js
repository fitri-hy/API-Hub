const { marked } = require('marked');
const db = require('../../config/database');
const Package = require('../../models/Package');
const Api = require('../../models/Api');
const ApiRoute = require('../../models/ApiRoute');
const AdminSettings = require('../../models/AdminSettings');

const publicController = {
	// Landing
	async getLanding(req, res) {
		const packages = await Package.findActive();

		const formattedPackages = packages.map(pkg => ({
			...pkg,
			features: pkg.features
				? typeof pkg.features === 'string'
					? JSON.parse(pkg.features)
					: pkg.features
				: []
		}));

		return res.render('landing', {
			title: 'One API Key for Everything',
			layout: 'layouts/public',
			packages: formattedPackages
		});
	},

	// Browser APIs
	async getBrowserApi(req, res) {
		const page = Math.max(1, parseInt(req.query.page) || 1);
		const perPage = 15;
		const search = (req.query.search || '').trim();

		let where = `deleted_at IS NULL AND status = 'active' AND is_public = 1`;
		const params = [];

		if (search) {
			where += ` AND (name LIKE ? OR slug LIKE ? OR description LIKE ?)`;
			const keyword = `%${search}%`;
			params.push(keyword, keyword, keyword);
		}

		const [countRows] = await db.query(
			`SELECT COUNT(*) AS total FROM apis WHERE ${where}`,
			params
		);

		const total = countRows[0].total;
		const totalPages = Math.ceil(total / perPage);
		const offset = (page - 1) * perPage;

		const [apis] = await db.query(
			`SELECT * FROM apis
			 WHERE ${where}
			 ORDER BY name ASC
			 LIMIT ? OFFSET ?`,
			[...params, perPage, offset]
		);

		const formattedApis = await Promise.all(
			apis.map(async api => {
				const routes = await ApiRoute.findActiveByApiId(api.id);

				return {
					...api,
					routes
				};
			})
		);

		const pages = [];

		if (totalPages <= 7) {
			for (let i = 1; i <= totalPages; i++) {
				pages.push(i);
			}
		} else {
			pages.push(1);

			if (page > 4) {
				pages.push('...');
			}

			const start = Math.max(2, page - 2);
			const end = Math.min(totalPages - 1, page + 2);

			for (let i = start; i <= end; i++) {
				pages.push(i);
			}

			if (page < totalPages - 3) {
				pages.push('...');
			}

			pages.push(totalPages);
		}

		return res.render('browser-api', {
			title: 'Browser APIs',
			layout: 'layouts/public',
			apis: formattedApis,
			pagination: {
				currentPage: page,
				perPage,
				total,
				totalPages,
				pages
			},
			filters: {
				search
			}
		});
	},

	// Browser APIs Detail
	async getBrowserApiDetail(req, res) {
		const api = await Api.findBySlug(req.params.slug);

		if (!api || api.status !== 'active' || !api.is_public) {
			return res.redirect('/browser-apis');
		}

		const routes = await ApiRoute.findActiveByApiId(api.id);

		const formattedRoutes = routes.map(route => {
			let sampleResponse = route.sample_response;

			if (sampleResponse) {
				try {
					const parsed = typeof sampleResponse === 'string'
						? JSON.parse(sampleResponse)
						: sampleResponse;

					sampleResponse = JSON.stringify(parsed, null, 2);
				} catch (err) {
					sampleResponse = String(sampleResponse);
				}
			}

			return {
				...route,
				documentation: route.documentation
					? marked.parse(route.documentation)
					: '',
				sampleResponse
			};
		});

		return res.render('browser-api-detail', {
			title: api.name,
			layout: 'layouts/public',
			api,
			routes: formattedRoutes
		});
	},

	// Contact
	getContact(req, res) {
		return res.render('contact', {
			title: 'Contact Us',
			layout: 'layouts/public'
		});
	},

	// About
	async getAbout(req, res) {
	  try {
		const stats = await Api.getPublicStats();

		return res.render('about', {
		  title: 'About Us',
		  layout: 'layouts/public',
		  stats
		});

	  } catch (error) {
		console.error('Get About error:', error);

		return res.render('about', {
		  title: 'About Us',
		  layout: 'layouts/public',
		  stats: {
			apiCount: 0,
			endpointCount: 0
		  }
		});
	  }
	},

	// Terms of Service
	getTerms(req, res) {
		return res.render('term', {
			title: 'Terms of Service',
			layout: 'layouts/public'
		});
	},

	// Privacy Policy
	getPrivacy(req, res) {
		return res.render('privacy', {
			title: 'Privacy Policy',
			layout: 'layouts/public'
		});
	},

	// Security
	getSecurity(req, res) {
		return res.render('security', {
			title: 'Security',
			layout: 'layouts/public'
		});
	},

	// Referral
	async getReferral(req, res) {
	  try {
		const newReferralCreditAmount = await AdminSettings.get(
		  'new_referral_credit_amount'
		);

		const referralCreditAmount = await AdminSettings.get(
		  'referral_credit_amount'
		);

		const defaultCredits = await AdminSettings.get(
		  'default_credits'
		);

		return res.render('referral', {
		  title: 'Referral Program',
		  layout: 'layouts/public',
		  newReferralCreditAmount: newReferralCreditAmount || 0,
		  referralCreditAmount: referralCreditAmount || 0,
		  defaultCredits: defaultCredits || 0
		});

	  } catch (error) {
		console.error('Get Referral error:', error);

		return res.render('referral', {
		  title: 'Referral Program',
		  layout: 'layouts/public',
		  newReferralCreditAmount: 0,
		  referralCreditAmount: 0,
		  defaultCredits: 0
		});
	  }
	},
};

module.exports = publicController;