import TeacherStats from '../models/TeacherStats.js';
import Assignment from '../models/Assignment.js';
import User from '../models/User.js';
import path from 'path';
import fs from 'fs';
import emailService from '../services/emailService.js';
import notificationService from '../services/notificationService.js';

// Crear una nueva asignación
export const createAssignment = async (req, res) => {
    try {
        const { title, description, dueDate, closeDate, isGeneral } = req.body;
        let assignedTo = req.body['assignedTo[]'] || req.body.assignedTo;

        // Validar datos requeridos
        if (!title || !description || !dueDate || !closeDate) {
            if (req.files) {
                req.files.forEach(file => {
                    fs.unlinkSync(file.path);
                });
            }
            return res.status(400).json({
                success: false,
                error: 'Todos los campos son requeridos: título, descripción, fecha de vencimiento y fecha de cierre'
            });
        }

        // Validar que la fecha de cierre sea posterior o igual a la fecha de vencimiento
        const dueDateObj = new Date(dueDate);
        const closeDateObj = new Date(closeDate);
        
        if (closeDateObj < dueDateObj) {
            if (req.files) {
                req.files.forEach(file => {
                    fs.unlinkSync(file.path);
                });
            }
            return res.status(400).json({
                success: false,
                error: 'La fecha de cierre debe ser posterior o igual a la fecha de vencimiento'
            });
        }

        // Crear la asignación base
        const assignment = new Assignment({
            title: title.trim(),
            description: description.trim(),
            dueDate: dueDateObj,
            closeDate: closeDateObj,
            isGeneral: isGeneral === 'true' || isGeneral === true,
            createdBy: req.user._id,
            status: 'pending'
        });

        // Manejar archivos adjuntos si existen
        if (req.files && req.files.length > 0) {
            assignment.attachments = req.files.map(file => ({
                fileName: file.originalname,
                fileUrl: file.path.replace(/\\/g, '/'),
                uploadedAt: new Date()
            }));
        }

        let teachers = [];

        // Si es una asignación general, asignar a todos los docentes
        if (assignment.isGeneral) {
            teachers = await User.find({ role: 'docente' }).select('_id nombre apellidoPaterno apellidoMaterno email');
            if (!teachers || teachers.length === 0) {
                throw new Error('No se encontraron docentes para asignar');
            }
            assignment.assignedTo = teachers.map(teacher => teacher._id);
        } else {
            // Si no es general, usar los IDs proporcionados
            if (!assignedTo || (Array.isArray(assignedTo) && assignedTo.length === 0)) {
                throw new Error('Debe seleccionar al menos un docente para asignaciones individuales');
            }

            // Asegurarse de que assignedTo sea un array
            if (!Array.isArray(assignedTo)) {
                assignedTo = [assignedTo];
            }

            // Verificar que todos los usuarios asignados existan y sean docentes
            teachers = await User.find({
                _id: { $in: assignedTo },
                role: 'docente'
            }).select('_id nombre apellidoPaterno apellidoMaterno email');

            if (!teachers || teachers.length !== assignedTo.length) {
                throw new Error('Uno o más usuarios seleccionados no son válidos o no son docentes');
            }

            assignment.assignedTo = teachers.map(teacher => teacher._id);
        }

        // Guardar la asignación
        await assignment.save();

        // Actualizar estadísticas para cada profesor asignado
        try {
            for (const teacher of teachers) {
                await TeacherStats.updateTeacherStats(teacher._id);
            }
        } catch (statsError) {
            console.error('Error al actualizar estadísticas:', statsError);
            // No detenemos el proceso si falla la actualización de estadísticas
        }

        // Poblar los datos de los usuarios asignados para la respuesta
        const populatedAssignment = await Assignment.findById(assignment._id)
            .populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email')
            .populate('createdBy', 'nombre apellidoPaterno apellidoMaterno');

        // Enviar notificaciones por correo electrónico y en tiempo real
        for (const teacher of teachers) {
            const teacherName = `${teacher.nombre} ${teacher.apellidoPaterno} ${teacher.apellidoMaterno}`;
            const assignmentUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/dashboard/assignments/${assignment._id}`;

            // Enviar correo electrónico
            await emailService.sendNewAssignmentNotification({
                to: teacher.email,
                teacherName,
                title: assignment.title,
                description: assignment.description,
                dueDate: assignment.dueDate,
                closeDate: assignment.closeDate,
                assignmentUrl
            });
        }

        // Enviar notificaciones en tiempo real
        notificationService.sendNewAssignmentNotification(
            assignment.assignedTo,
            populatedAssignment
        );

        res.status(201).json({
            success: true,
            message: 'Asignación creada exitosamente',
            data: populatedAssignment
        });
    } catch (error) {
        // Si hay archivos subidos, eliminarlos ya que hubo un error
        if (req.files) {
            req.files.forEach(file => {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });
        }

        console.error('Error al crear asignación:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al crear la asignación'
        });
    }
};

// Obtener todas las asignaciones (para admin)
export const getAllAssignments = async (req, res) => {
    try {
        const assignments = await Assignment.find()
            .populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email')
            .populate('createdBy', 'nombre apellidoPaterno apellidoMaterno')
            .sort('-createdAt');

        res.status(200).json({
            success: true,
            assignments: assignments,
            total: assignments.length
        });
    } catch (error) {
        console.error('Error al obtener asignaciones:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al obtener las asignaciones'
        });
    }
};

// Obtener asignaciones de un usuario específico
export const getUserAssignments = async (req, res) => {
    try {
        const assignments = await Assignment.find({
            assignedTo: req.user._id
        })
        .populate('createdBy', 'nombre apellidoPaterno apellidoMaterno role')
        .sort('-createdAt');

        res.status(200).json({
            success: true,
            assignments: assignments,
            total: assignments.length
        });
    } catch (error) {
        console.error('Error al obtener asignaciones del usuario:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al obtener las asignaciones'
        });
    }
};

// Subir respuesta a una asignación
export const submitAssignmentResponse = async (req, res) => {
    try {
        const assignment = await Assignment.findById(req.params.id);
        
        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        // Verificar que el usuario esté asignado a esta tarea
        if (!assignment.assignedTo.includes(req.user._id)) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permiso para responder a esta asignación'
            });
        }

        const now = new Date();
        const dueDate = new Date(assignment.dueDate);
        const closeDate = new Date(assignment.closeDate);

        // Verificar si la fecha de cierre ya pasó
        if (now > closeDate) {
            // Si hay archivos subidos, eliminarlos ya que la asignación está cerrada
            if (req.files) {
                req.files.forEach(file => {
                    fs.unlinkSync(file.path);
                });
            }
            return res.status(403).json({
                success: false,
                error: 'La fecha límite para entregar esta asignación ya ha pasado',
                submissionStatus: 'closed',
                closeDate: closeDate,
                dueDate: dueDate
            });
        }

        // Determinar el estado de la entrega
        let submissionStatus = 'on-time';
        if (now > dueDate) {
            submissionStatus = 'late';
        }

        const response = {
            user: req.user._id,
            files: req.files ? req.files.map(file => ({
                fileName: file.originalname,
                fileUrl: file.path
            })) : [],
            submissionStatus: submissionStatus,
            submittedAt: now
        };

        // Evitar respuestas duplicadas del mismo usuario
        const existingResponseIndex = assignment.responses.findIndex(
            r => r.user.toString() === req.user._id.toString()
        );

        if (existingResponseIndex !== -1) {
            assignment.responses[existingResponseIndex] = response;
        } else {
            assignment.responses.push(response);
        }

        await assignment.save();

        res.status(200).json({
            success: true,
            data: assignment,
            submissionStatus: submissionStatus,
            message: submissionStatus === 'late' ? 
                'Entrega realizada con retraso' : 
                'Entrega realizada a tiempo'
        });
    } catch (error) {
        console.error('Error al subir respuesta:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al subir la respuesta'
        });
    }
};

// Actualizar estado de una asignación
export const updateAssignmentStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const assignment = await Assignment.findById(req.params.id);

        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        assignment.status = status;
        await assignment.save();

        res.status(200).json({
            success: true,
            data: assignment
        });
    } catch (error) {
        console.error('Error al actualizar estado:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al actualizar el estado'
        });
    }
};

// Obtener estadísticas del dashboard del usuario
export const getUserDashboardStats = async (req, res) => {
    try {
        // Obtener estadísticas actualizadas
        const stats = await TeacherStats.findOne({ teacher: req.user._id });
        
        if (!stats) {
            // Si no existen estadísticas, crearlas
            await TeacherStats.updateTeacherStats(req.user._id);
            const newStats = await TeacherStats.findOne({ teacher: req.user._id });
            
            return res.status(200).json({
                success: true,
                stats: newStats.stats
            });
        }

        res.status(200).json({
            success: true,
            stats: stats.stats
        });
    } catch (error) {
        console.error('Error al obtener estadísticas:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al obtener las estadísticas'
        });
    }
};

// Obtener una asignación específica por ID
export const getAssignmentById = async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const userId = req.user._id;

        const assignment = await Assignment.findById(assignmentId)
            .populate('createdBy', 'nombre apellidoPaterno apellidoMaterno email role')
            .populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email');

        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        // Verificar que el usuario tenga acceso a esta asignación
        const isAssigned = assignment.assignedTo.some(user => user._id.toString() === userId.toString());
        const isCreator = assignment.createdBy._id.toString() === userId.toString();
        const isAdmin = req.user.role === 'admin';

        if (!isAssigned && !isCreator && !isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permiso para ver esta asignación'
            });
        }

        res.status(200).json({
            success: true,
            data: assignment
        });
    } catch (error) {
        console.error('Error al obtener asignación:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al obtener la asignación'
        });
    }
};

// Obtener asignaciones filtradas para docentes
export const getFilteredAssignments = async (req, res) => {
    try {
        const userId = req.user._id;
        const { status, priority, sort = 'dueDate', order = 'asc' } = req.query;

        // Construir filtros
        const filter = { assignedTo: userId };
        
        if (status) {
            filter.status = status;
        }
        
        if (priority) {
            filter.priority = priority;
        }

        // Construir ordenamiento
        const sortObj = {};
        sortObj[sort] = order === 'desc' ? -1 : 1;

        const assignments = await Assignment.find(filter)
            .populate('createdBy', 'nombre apellidoPaterno apellidoMaterno')
            .sort(sortObj);

        res.status(200).json({
            success: true,
            data: assignments,
            total: assignments.length,
            filters: { status, priority, sort, order }
        });
    } catch (error) {
        console.error('Error al obtener asignaciones filtradas:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al obtener las asignaciones filtradas'
        });
    }
};

// Obtener estadísticas de asignaciones del docente
export const getTeacherAssignmentStats = async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();
        
        // Obtener todas las asignaciones del docente
        const assignments = await Assignment.find({
            assignedTo: userId
        });

        // Calcular estadísticas
        const total = assignments.length;
        const completed = assignments.filter(a => a.status === 'completed').length;
        
        // Filtrar asignaciones pendientes y vencidas
        const pendingAssignments = assignments.filter(a => a.status === 'pending');
        const pending = pendingAssignments.filter(a => new Date(a.dueDate) > now).length;
        const overdue = pendingAssignments.filter(a => new Date(a.dueDate) <= now).length;

        console.log('Estadísticas calculadas:', { total, pending, completed, overdue }); // Para debug

        res.status(200).json({
            success: true,
            stats: {
                total,
                pending,
                completed,
                overdue
            }
        });
    } catch (error) {
        console.error('Error al obtener estadísticas de asignaciones:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al obtener las estadísticas'
        });
    }
};

// Obtener asignaciones filtradas para el docente
export const getTeacherFilteredAssignments = async (req, res) => {
    try {
        const { status, search, sort = '-createdAt', page = 1, limit = 10 } = req.query;
        const query = { assignedTo: req.user._id };
        const now = new Date();

        // Aplicar filtro de estado
        if (status && status !== 'all') {
            if (status === 'vencido') {
                // Para vencidas: mostrar solo las que están pendientes y pasaron su fecha de vencimiento
                query.status = 'pending';
                query.dueDate = { $lt: now };
            } else if (status === 'pending') {
                // Para pendientes: mostrar solo las que están pendientes y NO han pasado su fecha de vencimiento
                query.status = 'pending';
                query.dueDate = { $gt: now };
            } else if (status === 'completed') {
                // Para completadas: mostrar solo las completadas sin importar la fecha
                query.status = 'completed';
            }
        }

        // Aplicar búsqueda si existe
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        console.log('Query de filtrado:', query); // Para debug

        const assignments = await Assignment.find(query)
            .populate('createdBy', 'nombre apellidoPaterno apellidoMaterno role')
            .sort(sort)
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        const total = await Assignment.countDocuments(query);

        res.status(200).json({
            success: true,
            assignments,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                totalItems: total
            }
        });
    } catch (error) {
        console.error('Error al obtener asignaciones filtradas:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al obtener las asignaciones'
        });
    }
};

// Marcar asignación como completada
export const markAssignmentCompleted = async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const userId = req.user._id;

        console.log('🔄 Intentando marcar asignación como completada:', {
            assignmentId,
            userId: userId.toString()
        });

        const assignment = await Assignment.findById(assignmentId);
        
        if (!assignment) {
            console.log('❌ Asignación no encontrada');
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        console.log('📋 Asignación encontrada:', {
            title: assignment.title,
            assignedTo: assignment.assignedTo.map(id => id.toString()),
            status: assignment.status
        });

        // Verificar que el usuario esté asignado a esta tarea (comparar strings)
        const isAssigned = assignment.assignedTo.some(assignedId => 
            assignedId.toString() === userId.toString()
        );

        if (!isAssigned) {
            console.log('❌ Usuario no asignado a esta tarea');
            return res.status(403).json({
                success: false,
                error: 'No tienes permiso para modificar esta asignación'
            });
        }

        // Verificar que la asignación no esté ya completada
        if (assignment.status === 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Esta asignación ya está marcada como completada'
            });
        }

        // Verificar que no haya pasado la fecha de cierre
        const now = new Date();
        const closeDate = new Date(assignment.closeDate);
        
        if (now > closeDate) {
            return res.status(403).json({
                success: false,
                error: 'No se puede completar una asignación después de la fecha de cierre'
            });
        }

        // Actualizar la asignación
        assignment.status = 'completed';
        assignment.completedAt = new Date();
        
        const savedAssignment = await assignment.save();
        console.log('✅ Asignación guardada exitosamente');

        // Actualizar estadísticas del profesor
        await TeacherStats.updateTeacherStats(req.user._id);

        // Respuesta simple y directa
        res.status(200).json({
            success: true,
            message: 'Asignación marcada como completada exitosamente',
            data: {
                _id: savedAssignment._id,
                title: savedAssignment.title,
                status: savedAssignment.status,
                completedAt: savedAssignment.completedAt,
                dueDate: savedAssignment.dueDate,
                closeDate: savedAssignment.closeDate
            }
        });
        
    } catch (error) {
        console.error('❌ Error al marcar asignación como completada:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al actualizar la asignación'
        });
    }
};

// ========== FUNCIONES ESPECÍFICAS PARA ADMINISTRADOR ==========

// Obtener todas las asignaciones para administrador con filtros
export const getAdminAllAssignments = async (req, res) => {
    try {
        // Verificar que el usuario sea administrador
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Solo los administradores pueden acceder a todas las asignaciones'
            });
        }

        const {
            status = 'all',
            search = '',
            sort = '-createdAt',
            page = 1,
            limit = 10,
            teacherId
        } = req.query;

        // Construir filtros
        const filters = {};
        
        // Debug: mostrar el status recibido
        console.log('🔍 Status filter received:', status);
        
        if (status !== 'all') {
            if (status === 'overdue') {
                // Para vencidas: status = pending Y dueDate < now
                filters.status = 'pending';
                filters.dueDate = { $lt: new Date() };
                console.log('📅 Overdue filter applied:', filters);
            } else if (status === 'pending') {
                // Para pendientes: status = pending Y dueDate >= now
                filters.status = 'pending';
                filters.dueDate = { $gte: new Date() };
                console.log('📅 Pending filter applied:', filters);
            } else {
                // Para otros estados (completed, etc.)
                filters.status = status;
                console.log('📅 Status filter applied:', filters);
            }
        }

        if (search) {
            filters.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        if (teacherId && teacherId !== 'all') {
            filters.assignedTo = { $in: [teacherId] };
        }

        // Configurar paginación
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Obtener asignaciones con paginación
        const assignments = await Assignment.find(filters)
            .populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email')
            .populate('createdBy', 'nombre apellidoPaterno apellidoMaterno email')
            .sort(sort)
            .skip(skip)
            .limit(limitNum)
            .lean();

        // Contar total de documentos
        const total = await Assignment.countDocuments(filters);
        const totalPages = Math.ceil(total / limitNum);

        // Obtener lista de profesores para filtros
        const teachers = await User.find({ role: 'docente' })
            .select('nombre apellidoPaterno apellidoMaterno email')
            .sort('nombre')
            .lean();

        res.json({
            success: true,
            data: {
                assignments,
                pagination: {
                    current: pageNum,
                    pages: totalPages,
                    total,
                    limit: limitNum,
                    hasNext: pageNum < totalPages,
                    hasPrev: pageNum > 1
                },
                teachers
            }
        });

    } catch (error) {
        console.error('Error obteniendo todas las asignaciones para admin:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al obtener las asignaciones'
        });
    }
};

// Obtener estadísticas de asignaciones para administrador
export const getAdminAssignmentStats = async (req, res) => {
    try {
        // Verificar que el usuario sea administrador
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Solo los administradores pueden acceder a las estadísticas'
            });
        }

        // Obtener estadísticas generales de asignaciones
        const totalAssignments = await Assignment.countDocuments();
        const completedAssignments = await Assignment.countDocuments({ status: 'completed' });
        const pendingAssignments = await Assignment.countDocuments({ status: 'pending' });
        
        // Asignaciones vencidas (pending y fecha de vencimiento pasada)
        const now = new Date();
        const overdueAssignments = await Assignment.countDocuments({
            status: 'pending',
            dueDate: { $lt: now }
        });

        // Asignaciones por vencer en 24 horas
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dueSoonAssignments = await Assignment.countDocuments({
            status: 'pending',
            dueDate: { $gte: now, $lte: tomorrow }
        });

        // Estadísticas por profesor
        const teacherStats = await Assignment.aggregate([
            {
                $lookup: {
                    from: 'users',
                    localField: 'assignedTo',
                    foreignField: '_id',
                    as: 'teacher'
                }
            },
            {
                $unwind: '$teacher'
            },
            {
                $group: {
                    _id: '$assignedTo',
                    teacherName: {
                        $first: {
                            $concat: ['$teacher.nombre', ' ', '$teacher.apellidoPaterno', ' ', '$teacher.apellidoMaterno']
                        }
                    },
                    total: { $sum: 1 },
                    completed: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    pending: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                    },
                    overdue: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ['$status', 'pending'] },
                                        { $lt: ['$dueDate', now] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            {
                $addFields: {
                    completionRate: {
                        $cond: [
                            { $eq: ['$total', 0] },
                            0,
                            { $multiply: [{ $divide: ['$completed', '$total'] }, 100] }
                        ]
                    }
                }
            },
            {
                $sort: { completionRate: -1 }
            }
        ]);

        res.json({
            success: true,
            data: {
                overview: {
                    total: totalAssignments,
                    completed: completedAssignments,
                    pending: pendingAssignments,
                    overdue: overdueAssignments,
                    dueSoon: dueSoonAssignments,
                    completionRate: totalAssignments > 0 ? ((completedAssignments / totalAssignments) * 100).toFixed(1) : 0
                },
                teacherStats
            }
        });

    } catch (error) {
        console.error('Error obteniendo estadísticas para admin:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al obtener las estadísticas'
        });
    }
};

// Marcar asignación como completada desde administrador
export const markAssignmentCompletedByAdmin = async (req, res) => {
    try {
        // Verificar que el usuario sea administrador
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Solo los administradores pueden marcar asignaciones como completadas'
            });
        }

        const { assignmentId } = req.params;

        // Buscar la asignación
        const assignment = await Assignment.findById(assignmentId)
            .populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email');

        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        // Verificar que la asignación no esté ya completada
        if (assignment.status === 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Esta asignación ya está marcada como completada'
            });
        }

        // Marcar como completada
        assignment.status = 'completed';
        assignment.completedAt = new Date();
        assignment.completedBy = req.user._id;
        assignment.adminCompleted = true; // Flag para indicar que fue completada por admin

        await assignment.save();

        // Enviar notificación al profesor
        try {
            await notificationService.sendNotification({
                userId: assignment.assignedTo._id,
                type: 'assignment_completed_by_admin',
                title: 'Asignación marcada como completada',
                message: `El administrador ha marcado la asignación "${assignment.title}" como completada.`,
                relatedId: assignment._id,
                relatedType: 'Assignment'
            });
        } catch (notifError) {
            console.error('Error enviando notificación:', notifError);
        }

        res.json({
            success: true,
            message: 'Asignación marcada como completada exitosamente',
            data: assignment
        });

    } catch (error) {
        console.error('Error marcando asignación como completada por admin:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al marcar la asignación como completada'
        });
    }
};

// Actualizar asignación desde administrador
export const updateAssignmentByAdmin = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const updateData = req.body;
        
        console.log('📝 Admin actualizando asignación:', assignmentId);
        console.log('📋 Datos de actualización:', updateData);

        // Verificar que el usuario sea administrador
        if (!req.user || req.user.role !== 'admin') {
            console.log('❌ Usuario no autorizado:', req.user?.role);
            return res.status(403).json({
                success: false,
                error: 'Solo los administradores pueden actualizar asignaciones'
            });
        }

        // Buscar la asignación
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            console.log('❌ Asignación no encontrada:', assignmentId);
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        // Validar datos de entrada
        const allowedFields = ['title', 'description', 'dueDate', 'closeDate', 'isGeneral', 'assignedTo'];
        const filteredData = {};
        
        allowedFields.forEach(field => {
            if (updateData[field] !== undefined) {
                filteredData[field] = updateData[field];
            }
        });

        // Validaciones específicas
        if (filteredData.dueDate && filteredData.closeDate) {
            const dueDate = new Date(filteredData.dueDate);
            const closeDate = new Date(filteredData.closeDate);
            
            if (closeDate < dueDate) {
                return res.status(400).json({
                    success: false,
                    error: 'La fecha de cierre debe ser posterior a la fecha de entrega'
                });
            }
        }

        // Si es asignación general, limpiar assignedTo
        if (filteredData.isGeneral) {
            filteredData.assignedTo = [];
        }

        // Manejar edición específica por docente
        if (updateData.editMode === 'specific' && updateData.specificTeacherId) {
            console.log('🎯 Editando para docente específico:', updateData.specificTeacherId);
            
            // Verificar que el docente esté asignado a esta asignación
            const isTeacherAssigned = assignment.assignedTo.some(
                teacherId => teacherId.toString() === updateData.specificTeacherId
            );
            
            if (!isTeacherAssigned) {
                return res.status(400).json({
                    success: false,
                    error: 'El docente seleccionado no está asignado a esta asignación'
                });
            }

            // Crear una nueva asignación específica para el docente
            const specificAssignment = new Assignment({
                title: filteredData.title || assignment.title,
                description: filteredData.description || assignment.description,
                dueDate: filteredData.dueDate || assignment.dueDate,
                closeDate: filteredData.closeDate || assignment.closeDate,
                assignedTo: [updateData.specificTeacherId],
                createdBy: assignment.createdBy,
                isGeneral: false,
                status: 'pending',
                originalAssignmentId: assignmentId // Referencia a la asignación original
            });

            await specificAssignment.save();

            // Remover el docente de la asignación original
            await Assignment.findByIdAndUpdate(
                assignmentId,
                {
                    $pull: { assignedTo: updateData.specificTeacherId }
                }
            );

            console.log('✅ Asignación específica creada exitosamente');

            // Actualizar estadísticas del docente
            await TeacherStats.updateTeacherStats(updateData.specificTeacherId);

            return res.json({
                success: true,
                message: 'Asignación específica creada exitosamente',
                data: specificAssignment,
                type: 'specific_assignment_created'
            });

        } else {
            // Edición normal para todos los docentes
            console.log('📋 Editando para todos los docentes asignados');
            
            const updatedAssignment = await Assignment.findByIdAndUpdate(
                assignmentId,
                filteredData,
                { 
                    new: true,
                    runValidators: true 
                }
            ).populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email');

            console.log('✅ Asignación actualizada exitosamente');

            // Actualizar estadísticas de los docentes afectados
            if (filteredData.assignedTo) {
                // Actualizar estadísticas de los docentes previamente asignados
                if (assignment.assignedTo && assignment.assignedTo.length > 0) {
                    for (const teacherId of assignment.assignedTo) {
                        await TeacherStats.updateTeacherStats(teacherId);
                    }
                }
                
                // Actualizar estadísticas de los nuevos docentes asignados
                if (filteredData.assignedTo.length > 0) {
                    for (const teacherId of filteredData.assignedTo) {
                        await TeacherStats.updateTeacherStats(teacherId);
                    }
                }
            }

            return res.json({
                success: true,
                message: 'Asignación actualizada exitosamente',
                data: updatedAssignment,
                type: 'assignment_updated'
            });
        }

    } catch (error) {
        console.error('Error actualizando asignación por admin:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error al actualizar la asignación'
        });
    }
};