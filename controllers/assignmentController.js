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
        
        console.log('📊 Calculando estadísticas para docente:', req.user.email);
        console.log('📋 ID del docente:', userId);

        // Obtener todas las asignaciones del docente con respuestas populadas
        const assignments = await Assignment.find({
            assignedTo: userId
        }).populate('responses.user', 'nombre apellidoPaterno apellidoMaterno email');

        console.log(`📊 Total de asignaciones encontradas: ${assignments.length}`);

        // Calcular estadísticas considerando las respuestas individuales del docente
        const total = assignments.length;
        let pending = 0;
        let completed = 0;
        let completedLate = 0;
        let notDelivered = 0;

        assignments.forEach(assignment => {
            // Buscar respuesta específica del docente actual
            const teacherResponse = assignment.responses.find(r => 
                r.user._id.toString() === userId.toString()
            );

            if (teacherResponse) {
                // Si existe respuesta, usar el mapeo de estados de la respuesta
                if (teacherResponse.status === 'submitted' && teacherResponse.submissionStatus === 'on-time') {
                    completed++;
                } else if (teacherResponse.status === 'submitted' && teacherResponse.submissionStatus === 'late') {
                    completedLate++;
                } else if (teacherResponse.submissionStatus === 'closed' || (teacherResponse.status === 'reviewed' && !teacherResponse.submittedAt)) {
                    notDelivered++;
                } else {
                    pending++;
                }
            } else {
                // Si no hay respuesta, usar el estado base de la asignación
                switch(assignment.status) {
                    case 'completed':
                        completed++;
                        break;
                    case 'completed-late':
                        completedLate++;
                        break;
                    case 'not-delivered':
                        notDelivered++;
                        break;
                    case 'pending':
                    case 'active':
                    default:
                        pending++;
                        break;
                }
            }
        });

        console.log('📊 Estadísticas calculadas (con respuestas individuales):', { 
            total, 
            pending, 
            completed, 
            completedLate, 
            notDelivered 
        });

        res.status(200).json({
            success: true,
            stats: {
                total,
                pending,
                completed,
                completedLate,
                notDelivered
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
        const userId = req.user._id;
        const now = new Date();

        console.log('🔍 Obteniendo asignaciones para docente:', req.user.email);
        console.log('📋 Filtros recibidos:', { status, search, sort });

        // Construir query base - buscar asignaciones asignadas al docente
        let query = { assignedTo: userId };

        // Para filtros de estado, NO aplicar filtro directo al query porque cada docente puede tener un estado individual
        // El filtrado se hará después basándose en las respuestas individuales
        const statusFilter = status && status !== 'all' ? status : null;

        // Aplicar búsqueda si existe
        if (search) {
            query.$and = query.$and || [];
            query.$and.push({
                $or: [
                    { title: { $regex: search, $options: 'i' } },
                    { description: { $regex: search, $options: 'i' } }
                ]
            });
        }

        console.log('🔎 Query construida:', JSON.stringify(query, null, 2));

        const assignments = await Assignment.find(query)
            .populate('createdBy', 'nombre apellidoPaterno apellidoMaterno role')
            .populate('responses.user', 'nombre apellidoPaterno apellidoMaterno email')
            .sort(sort)
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        const total = await Assignment.countDocuments(query);

        console.log(`📊 Asignaciones encontradas: ${assignments.length} de ${total} total`);

        // Procesar las asignaciones para incluir el estado específico del docente actual
        let processedAssignments = assignments.map(assignment => {
            const assignmentObj = assignment.toObject();
            
            // Buscar la respuesta específica del docente actual
            const teacherResponse = assignment.responses.find(
                response => response.user._id.toString() === userId.toString()
            );
            
            let teacherSpecificStatus = 'pending'; // Estado por defecto
            
            if (teacherResponse) {
                // Si existe una respuesta, mapear el estado usando la misma lógica que en getTeachersStatusForAssignment
                if (teacherResponse.status === 'submitted' && teacherResponse.submissionStatus === 'on-time') {
                    teacherSpecificStatus = 'completed';
                } else if (teacherResponse.status === 'submitted' && teacherResponse.submissionStatus === 'late') {
                    teacherSpecificStatus = 'completed-late';
                } else if (teacherResponse.submissionStatus === 'closed' || (teacherResponse.status === 'reviewed' && !teacherResponse.submittedAt)) {
                    teacherSpecificStatus = 'not-delivered';
                } else {
                    teacherSpecificStatus = 'pending';
                }
                
                assignmentObj.teacherStatus = {
                    submissionStatus: teacherResponse.submissionStatus,
                    status: teacherResponse.status,
                    submittedAt: teacherResponse.submittedAt,
                    adminUpdated: true,
                    mappedStatus: teacherSpecificStatus
                };
                
                console.log(`✅ "${assignment.title}" - Estado específico del docente:`, {
                    status: teacherResponse.status,
                    submissionStatus: teacherResponse.submissionStatus,
                    mappedStatus: teacherSpecificStatus
                });
            } else {
                // Si no existe respuesta, usar el estado base de la asignación
                teacherSpecificStatus = assignment.status === 'active' ? 'pending' : assignment.status;
                
                // Para vencidas, verificar la fecha si no hay respuesta
                if (teacherSpecificStatus === 'pending' && new Date(assignment.dueDate) < now) {
                    teacherSpecificStatus = 'vencido';
                }
                
                assignmentObj.teacherStatus = {
                    submissionStatus: null,
                    status: teacherSpecificStatus,
                    submittedAt: null,
                    adminUpdated: false,
                    mappedStatus: teacherSpecificStatus
                };
                
                console.log(`📋 "${assignment.title}" - Estado base (sin respuesta):`, {
                    statusOriginal: assignment.status,
                    statusParaDocente: teacherSpecificStatus
                });
            }
            
            return assignmentObj;
        });

        // Aplicar filtro de estado DESPUÉS de mapear los estados individuales
        if (statusFilter) {
            processedAssignments = processedAssignments.filter(assignment => {
                const mappedStatus = assignment.teacherStatus.mappedStatus;
                
                switch(statusFilter) {
                    case 'pending':
                        return mappedStatus === 'pending';
                    case 'completed':
                        return mappedStatus === 'completed';
                    case 'completed-late':
                        return mappedStatus === 'completed-late';
                    case 'not-delivered':
                        return mappedStatus === 'not-delivered';
                    case 'vencido':
                        return mappedStatus === 'vencido';
                    default:
                        return mappedStatus === statusFilter;
                }
            });
            
            console.log(`🔽 Después del filtro "${statusFilter}": ${processedAssignments.length} asignaciones`);
        }

        // Recalcular el total y paginación basándose en los resultados filtrados
        const filteredTotal = statusFilter ? processedAssignments.length : total;
        const totalPages = Math.ceil(filteredTotal / parseInt(limit));

        res.status(200).json({
            success: true,
            assignments: processedAssignments,
            pagination: {
                currentPage: parseInt(page),
                totalPages: totalPages,
                totalItems: filteredTotal
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

        // Crear o actualizar la respuesta específica del docente
        const teacherResponseIndex = assignment.responses.findIndex(
            r => r.user.toString() === userId.toString()
        );

        const responseData = {
            user: userId,
            submissionStatus: 'on-time',
            status: 'submitted',
            submittedAt: now
        };

        if (teacherResponseIndex !== -1) {
            assignment.responses[teacherResponseIndex] = {
                ...assignment.responses[teacherResponseIndex],
                ...responseData
            };
        } else {
            assignment.responses.push(responseData);
        }

        // Actualizar la asignación
        assignment.status = 'completed';
        assignment.completedAt = now;
        
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

        console.log('🔍 Admin query params:', { status, search, sort, page, limit, teacherId });

        // Construir filtros
        const filters = {};
        
        // Debug: mostrar el status recibido
        console.log('🔍 Status filter received:', status);
        
        if (status !== 'all') {
            // Para los nuevos estados específicos
            if (status === 'completed' || status === 'completed-late' || status === 'not-delivered' || status === 'pending') {
                filters.status = status;
                console.log('📅 Status filter applied:', filters);
            } else if (status === 'overdue') {
                // Para vencidas: asignaciones pendientes que pasaron su fecha límite
                const now = new Date();
                filters.status = 'pending';
                filters.dueDate = { $lt: now };
                console.log('⚠️ Overdue filter applied:', filters);
            }
        }

        if (search) {
            filters.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        // Filtro por docente - CORREGIDO
        if (teacherId && teacherId !== 'all') {
            console.log('🎯 Filtering by teacher:', teacherId);
            filters.assignedTo = teacherId;
        }

        console.log('🔎 Final filters:', JSON.stringify(filters, null, 2));

        // Configurar paginación
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        console.log('📄 Pagination:', { pageNum, limitNum, skip });

        // Obtener asignaciones con paginación - CORREGIDO: populamos assignedTo después del filtro
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

        console.log('📊 Results:', { 
            totalFound: assignments.length, 
            totalInDB: total, 
            totalPages,
            currentPage: pageNum
        });

        // Obtener lista de profesores para filtros
        const teachers = await User.find({ role: 'docente' })
            .select('nombre apellidoPaterno apellidoMaterno email')
            .sort('nombre')
            .lean();

        console.log('👥 Teachers for filter:', teachers.length);

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
        const completedLateAssignments = await Assignment.countDocuments({ status: 'completed-late' });
        const notDeliveredAssignments = await Assignment.countDocuments({ status: 'not-delivered' });
        const pendingAssignments = await Assignment.countDocuments({ status: 'pending' });
        
        // Calcular asignaciones vencidas (pendientes que pasaron su fecha límite)
        const now = new Date();
        const overdueAssignments = await Assignment.countDocuments({
            status: 'pending',
            dueDate: { $lt: now }
        });
        
        // Asignaciones por vencer en 24 horas (solo pendientes)
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
                    'completed-late': completedLateAssignments,
                    'not-delivered': notDeliveredAssignments,
                    pending: pendingAssignments,
                    overdue: overdueAssignments,
                    dueSoon: dueSoonAssignments,
                    completionRate: totalAssignments > 0 ? (((completedAssignments + completedLateAssignments) / totalAssignments) * 100).toFixed(1) : 0
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

// ========== FUNCIONES PARA ASIGNACIONES PROGRAMADAS ==========

// Programar una nueva asignación
export const scheduleAssignment = async (req, res) => {
    try {
        console.log('📤 Iniciando programación de asignación...');
        console.log('📋 Datos recibidos:', JSON.stringify(req.body, null, 2));
        console.log('👤 Usuario autenticado:', req.user ? { id: req.user._id, email: req.user.email } : 'No autenticado');

        const { 
            title, 
            description, 
            dueDate, 
            closeDate, 
            publishDate,
            assignedTo,
            assignToAll,
            priority,
            reminderEnabled,
            reminderDays
        } = req.body;

        // Validar que el usuario esté autenticado
        if (!req.user || !req.user._id) {
            console.error('❌ Usuario no autenticado');
            return res.status(401).json({
                success: false,
                error: 'Usuario no autenticado'
            });
        }

        // Validar datos requeridos
        if (!title || !description || !publishDate || !dueDate || !closeDate) {
            console.error('❌ Datos faltantes:', { 
                title: !!title, 
                description: !!description, 
                publishDate: !!publishDate, 
                dueDate: !!dueDate, 
                closeDate: !!closeDate 
            });
            return res.status(400).json({
                success: false,
                error: 'Todos los campos son requeridos: título, descripción, fecha de publicación, fecha de vencimiento y fecha de cierre'
            });
        }

        // Validar fechas
        const publishDateObj = new Date(publishDate);
        const dueDateObj = new Date(dueDate);
        const closeDateObj = new Date(closeDate);
        const now = new Date();

        console.log('📅 Validando fechas:', {
            now: now.toISOString(),
            publishDate: publishDateObj.toISOString(),
            dueDate: dueDateObj.toISOString(),
            closeDate: closeDateObj.toISOString()
        });

        if (isNaN(publishDateObj.getTime()) || isNaN(dueDateObj.getTime()) || isNaN(closeDateObj.getTime())) {
            console.error('❌ Fechas inválidas');
            return res.status(400).json({
                success: false,
                error: 'Las fechas proporcionadas no son válidas'
            });
        }

        if (publishDateObj < now) {
            console.log('⚠️ Fecha de publicación en el pasado, ajustando a ahora');
            publishDateObj.setTime(now.getTime() + 1000); // 1 segundo en el futuro
        }

        if (dueDateObj <= publishDateObj) {
            console.error('❌ Fecha de entrega incorrecta');
            return res.status(400).json({
                success: false,
                error: 'La fecha de vencimiento debe ser posterior a la fecha de publicación'
            });
        }

        if (closeDateObj <= dueDateObj) {
            console.error('❌ Fecha de cierre incorrecta');
            return res.status(400).json({
                success: false,
                error: 'La fecha de cierre debe ser posterior o igual a la fecha de vencimiento'
            });
        }

        // Validar docentes asignados si no es para todos
        if (!assignToAll && (!assignedTo || assignedTo.length === 0)) {
            console.error('❌ No hay docentes asignados');
            return res.status(400).json({
                success: false,
                error: 'Debe seleccionar al menos un docente o marcar como asignación general'
            });
        }

        console.log('✅ Validaciones pasadas, creando asignación...');

        // Crear la asignación programada
        const assignmentData = {
            title: title.trim(),
            description: description.trim(),
            publishDate: publishDateObj,
            dueDate: dueDateObj,
            closeDate: closeDateObj,
            assignedTo: assignToAll ? [] : (assignedTo || []),
            isGeneral: assignToAll || false,
            status: 'scheduled',
            priority: priority || 'normal',
            reminderSettings: {
                enabled: reminderEnabled || false,
                daysBeforeDue: reminderDays || 2
            },
            scheduledPublish: true,
            createdBy: req.user._id
        };

        console.log('📝 Datos de asignación a crear:', JSON.stringify(assignmentData, null, 2));

        const scheduledAssignment = new Assignment(assignmentData);
        
        console.log('💾 Guardando en base de datos...');
        console.log('📋 Documento a guardar:', JSON.stringify(scheduledAssignment.toObject(), null, 2));
        
        const savedAssignment = await scheduledAssignment.save();
        
        console.log('✅ Asignación programada creada exitosamente:', savedAssignment._id);
        console.log('🔍 Verificando que se guardó correctamente...');
        
        // Verificar que se guardó correctamente
        const verifyAssignment = await Assignment.findById(savedAssignment._id);
        if (verifyAssignment) {
            console.log('✅ Verificación exitosa: La asignación se guardó en la BD');
        } else {
            console.error('❌ ERROR: La asignación NO se guardó en la BD');
        }

        res.status(201).json({
            success: true,
            message: 'Asignación programada exitosamente',
            data: {
                assignment: savedAssignment
            }
        });

    } catch (error) {
        console.error('❌ Error programando asignación:', error);
        console.error('❌ Stack trace:', error.stack);
        
        // Determinar el tipo de error y respuesta adecuada
        let errorMessage = 'Error interno del servidor';
        let statusCode = 500;
        
        if (error.name === 'ValidationError') {
            errorMessage = 'Error de validación de datos: ' + error.message;
            statusCode = 400;
        } else if (error.name === 'MongoError' && error.code === 11000) {
            errorMessage = 'Ya existe una asignación con esos datos';
            statusCode = 409;
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        res.status(statusCode).json({
            success: false,
            error: errorMessage
        });
    }
};

// Obtener asignaciones programadas
export const getScheduledAssignments = async (req, res) => {
    try {
        console.log('🔍 Obteniendo asignaciones programadas...');
        console.log('📋 Query params:', req.query);
        
        const { 
            status = 'all', 
            search = '', 
            sort = '-publishDate', 
            page = 1, 
            limit = 10 
        } = req.query;

        // Construir filtros
        const filters = { scheduledPublish: true };
        console.log('🔎 Filtros base:', filters);

        if (status !== 'all') {
            filters.status = status;
        }

        if (search) {
            filters.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        console.log('🔎 Filtros finales:', JSON.stringify(filters, null, 2));

        // Calcular paginación
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Primero, contar cuántos documentos existen con scheduledPublish: true
        const totalScheduledAssignments = await Assignment.countDocuments({ scheduledPublish: true });
        console.log('📊 Total de asignaciones con scheduledPublish=true:', totalScheduledAssignments);

        // Obtener asignaciones
        const assignments = await Assignment.find(filters)
            .populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email')
            .populate('createdBy', 'nombre apellidoPaterno apellidoMaterno email')
            .sort(sort)
            .skip(skip)
            .limit(limitNum);

        console.log('📋 Asignaciones encontradas:', assignments.length);
        if (assignments.length > 0) {
            console.log('📝 Primeras asignaciones:', assignments.slice(0, 3).map(a => ({
                id: a._id,
                title: a.title,
                status: a.status,
                scheduledPublish: a.scheduledPublish,
                publishDate: a.publishDate
            })));
        }

        // Obtener conteo total
        const total = await Assignment.countDocuments(filters);
        const pages = Math.ceil(total / limitNum);

        console.log('📊 Resultados finales:', {
            total,
            pages,
            currentPage: pageNum,
            assignmentsReturned: assignments.length
        });

        res.json({
            success: true,
            data: {
                assignments,
                pagination: {
                    page: pageNum,
                    pages,
                    total,
                    limit: limitNum
                }
            }
        });

    } catch (error) {
        console.error('Error obteniendo asignaciones programadas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
};

// Cancelar una asignación programada
export const cancelScheduledAssignment = async (req, res) => {
    try {
        const { id } = req.params;

        // Buscar la asignación
        const assignment = await Assignment.findById(id);
        
        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        // Verificar que sea una asignación programada
        if (!assignment.scheduledPublish) {
            return res.status(400).json({
                success: false,
                error: 'Esta asignación no es una asignación programada'
            });
        }

        // Verificar que esté en estado programado
        if (assignment.status !== 'scheduled') {
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden cancelar asignaciones en estado programado'
            });
        }

        // Actualizar estado a cancelado
        assignment.status = 'cancelled';
        assignment.cancelledAt = new Date();
        assignment.cancelledBy = req.user.userId;
        
        await assignment.save();

        res.json({
            success: true,
            message: 'Asignación programada cancelada exitosamente',
            data: {
                assignment
            }
        });

    } catch (error) {
        console.error('Error cancelando asignación programada:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
};

// Actualizar una asignación programada
export const updateScheduledAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        // Buscar la asignación
        const assignment = await Assignment.findById(id);
        
        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        // Verificar que sea una asignación programada
        if (!assignment.scheduledPublish) {
            return res.status(400).json({
                success: false,
                error: 'Esta asignación no es una asignación programada'
            });
        }

        // Verificar que esté en estado programado
        if (assignment.status !== 'scheduled') {
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden editar asignaciones en estado programado'
            });
        }

        // Validar fechas si se están actualizando
        if (updateData.publishDate || updateData.dueDate || updateData.closeDate) {
            const publishDate = new Date(updateData.publishDate || assignment.publishDate);
            const dueDate = new Date(updateData.dueDate || assignment.dueDate);
            const closeDate = new Date(updateData.closeDate || assignment.closeDate);
            const now = new Date();

            if (publishDate <= now) {
                return res.status(400).json({
                    success: false,
                    error: 'La fecha de publicación debe ser en el futuro'
                });
            }

            if (dueDate <= publishDate) {
                return res.status(400).json({
                    success: false,
                    error: 'La fecha de vencimiento debe ser posterior a la fecha de publicación'
                });
            }

            if (closeDate <= dueDate) {
                return res.status(400).json({
                    success: false,
                    error: 'La fecha de cierre debe ser posterior o igual a la fecha de vencimiento'
                });
            }
        }

        // Actualizar campos permitidos
        const allowedFields = [
            'title', 'description', 'publishDate', 'dueDate', 'closeDate',
            'assignedTo', 'isGeneral', 'priority', 'reminderSettings'
        ];

        allowedFields.forEach(field => {
            if (updateData[field] !== undefined) {
                assignment[field] = updateData[field];
            }
        });

        assignment.updatedAt = new Date();
        assignment.updatedBy = req.user.userId;

        await assignment.save();

        // Poblar campos para la respuesta
        await assignment.populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email');

        res.json({
            success: true,
            message: 'Asignación programada actualizada exitosamente',
            data: {
                assignment
            }
        });

    } catch (error) {
        console.error('Error actualizando asignación programada:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
};

// Función para publicar asignaciones programadas (llamada por cron job)
export const publishScheduledAssignments = async () => {
    try {
        const now = new Date();
        
        // Buscar asignaciones que deben ser publicadas
        const assignmentsToPublish = await Assignment.find({
            scheduledPublish: true,
            status: 'scheduled',
            publishDate: { $lte: now }
        }).populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email');

        console.log(`📅 Verificando asignaciones programadas... Encontradas: ${assignmentsToPublish.length}`);

        for (const assignment of assignmentsToPublish) {
            try {
                console.log(`📝 Procesando asignación: "${assignment.title}"`);
                console.log(`👥 Docentes asignados (antes de populate): ${assignment.assignedTo?.length || 0}`);
                
                // Cambiar estado a publicado
                assignment.status = 'active';
                assignment.publishedAt = now;
                await assignment.save();

                // Si es asignación general, asignar a todos los docentes
                if (assignment.isGeneral) {
                    const allTeachers = await User.find({ role: 'docente' });
                    assignment.assignedTo = allTeachers.map(teacher => teacher._id);
                    await assignment.save();
                }

                // POPULATOR DE NUEVO para obtener datos completos de docentes
                await assignment.populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email');
                
                console.log(`👥 Docentes después de populate: ${assignment.assignedTo?.length || 0}`);
                
                // Debug de docentes
                if (assignment.assignedTo && assignment.assignedTo.length > 0) {
                    assignment.assignedTo.forEach((teacher, index) => {
                        console.log(`   Docente ${index + 1}: ${teacher.nombre} ${teacher.apellidoPaterno} - ${teacher.email}`);
                    });
                }

                // Enviar notificaciones
                if (assignment.assignedTo && assignment.assignedTo.length > 0) {
                    for (const teacher of assignment.assignedTo) {
                        try {
                            // Enviar email
                            await emailService.sendNewAssignmentNotification({
                                to: teacher.email,
                                teacherName: `${teacher.nombre} ${teacher.apellidoPaterno}`,
                                title: assignment.title,
                                description: assignment.description,
                                dueDate: assignment.dueDate.toLocaleDateString('es-ES'),
                                closeDate: assignment.closeDate.toLocaleDateString('es-ES'),
                                assignmentUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/assignment/${assignment._id}`
                            });

                            // Enviar notificación web
                            await notificationService.sendNotification([teacher._id], {
                                type: 'new_assignment',
                                title: '📝 Nueva Asignación Disponible',
                                message: `Se ha publicado una nueva asignación: "${assignment.title}"`,
                                assignmentId: assignment._id
                            });

                        } catch (notificationError) {
                            console.error(`Error enviando notificación a ${teacher.email}:`, notificationError);
                        }
                    }
                }

                console.log(`✅ Asignación publicada: "${assignment.title}"`);

            } catch (error) {
                console.error(`❌ Error publicando asignación ${assignment._id}:`, error);
                
                // Marcar como error de publicación
                assignment.status = 'publication_error';
                assignment.publicationError = error.message;
                await assignment.save();
            }
        }

        return {
            success: true,
            publishedCount: assignmentsToPublish.length
        };

    } catch (error) {
        console.error('❌ Error en proceso de publicación automática:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// Actualizar estado de asignación para un docente específico
export const updateTeacherAssignmentStatus = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { teacherId, status } = req.body;
        
        console.log('📝 Admin actualizando estado de docente:', {
            assignmentId,
            teacherId,
            status,
            adminId: req.user._id
        });

        // Verificar que el usuario sea administrador
        if (!req.user || req.user.role !== 'admin') {
            console.log('❌ Usuario no autorizado:', req.user?.role);
            return res.status(403).json({
                success: false,
                error: 'Solo los administradores pueden actualizar estados de docentes'
            });
        }

        // Validar datos de entrada
        if (!teacherId || !status) {
            return res.status(400).json({
                success: false,
                error: 'teacherId y status son requeridos'
            });
        }

        // Validar el estado proporcionado
        const validStatuses = ['entregado', 'entregado_tarde', 'no_entregado', 'pendiente'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Estado inválido. Estados permitidos: ' + validStatuses.join(', ')
            });
        }

        // Buscar la asignación
        const assignment = await Assignment.findById(assignmentId)
            .populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email');
            
        if (!assignment) {
            console.log('❌ Asignación no encontrada:', assignmentId);
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        // Verificar que el docente esté asignado a esta asignación
        const isTeacherAssigned = assignment.assignedTo.some(
            teacher => teacher._id.toString() === teacherId
        );
        
        if (!isTeacherAssigned) {
            return res.status(400).json({
                success: false,
                error: 'El docente no está asignado a esta asignación'
            });
        }

        // Buscar si ya existe una respuesta del docente
        let teacherResponse = assignment.responses.find(
            response => response.user.toString() === teacherId
        );

        const now = new Date();
        let submissionStatus = 'on-time';
        
        // Determinar el estado de entrega basado en las fechas
        if (status === 'entregado' || status === 'entregado_tarde') {
            if (now > new Date(assignment.dueDate)) {
                submissionStatus = 'late';
            }
            if (now > new Date(assignment.closeDate)) {
                submissionStatus = 'closed';
            }
        }

        if (teacherResponse) {
            // Actualizar respuesta existente
            if (status === 'entregado' || status === 'entregado_tarde') {
                teacherResponse.submissionStatus = submissionStatus;
                teacherResponse.status = 'submitted';
                teacherResponse.submittedAt = now;
            } else {
                // Para 'no_entregado' o 'pendiente'
                teacherResponse.submissionStatus = null;
                teacherResponse.status = 'reviewed';
                teacherResponse.submittedAt = null;
            }
        } else {
            // Crear nueva respuesta
            assignment.responses.push({
                user: teacherId,
                files: [],
                submittedAt: status === 'entregado' || status === 'entregado_tarde' ? now : null,
                submissionStatus: status === 'entregado' || status === 'entregado_tarde' ? submissionStatus : null,
                status: status === 'entregado' || status === 'entregado_tarde' ? 'submitted' : 'reviewed'
            });
        }

        // Actualizar timestamp de modificación
        assignment.updatedAt = now;
        assignment.updatedBy = req.user._id;

        await assignment.save();

        // Poblar la asignación actualizada para la respuesta
        await assignment.populate([
            { path: 'assignedTo', select: 'nombre apellidoPaterno apellidoMaterno email' },
            { path: 'createdBy', select: 'nombre apellidoPaterno apellidoMaterno email' },
            { path: 'responses.user', select: 'nombre apellidoPaterno apellidoMaterno email' }
        ]);

        console.log('✅ Estado de docente actualizado exitosamente');

        res.json({
            success: true,
            message: 'Estado del docente actualizado exitosamente',
            assignment: assignment
        });

    } catch (error) {
        console.error('❌ Error actualizando estado del docente:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
};

// Obtener estados de docentes para una asignación específica
export const getTeachersStatusForAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;

        console.log('📋 Obteniendo estados de docentes para asignación:', assignmentId);

        const assignment = await Assignment.findById(assignmentId)
            .populate('assignedTo', 'nombre apellidoPaterno apellidoMaterno email')
            .populate('responses.user', 'nombre apellidoPaterno apellidoMaterno email');

        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        // Construir lista de docentes con sus estados usando el campo status directamente
        const teachersStatus = assignment.assignedTo.map(teacher => {
            const response = assignment.responses.find(r => 
                r.user._id.toString() === teacher._id.toString()
            );

            // Mapear el estado interno del backend al estado esperado por el frontend
            let status = 'pending'; // Por defecto
            
            if (response) {
                if (response.status === 'submitted' && response.submissionStatus === 'on-time') {
                    status = 'completed';
                } else if (response.status === 'submitted' && response.submissionStatus === 'late') {
                    status = 'completed-late';
                } else if (response.submissionStatus === 'closed' || (response.status === 'reviewed' && !response.submittedAt)) {
                    status = 'not-delivered';
                } else {
                    status = 'pending';
                }
            }

            return {
                _id: teacher._id,
                teacherId: teacher._id,
                nombre: teacher.nombre,
                apellidoPaterno: teacher.apellidoPaterno,
                apellidoMaterno: teacher.apellidoMaterno,
                email: teacher.email,
                status: status,
                submittedAt: response?.submittedAt || null
            };
        });

        res.json({
            success: true,
            teachersStatus: teachersStatus,
            assignment: {
                _id: assignment._id,
                title: assignment.title,
                description: assignment.description
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo estados de docentes:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
};

// Actualizar estado de un docente específico en una asignación
export const updateTeacherStatusInAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { teacherId, status } = req.body;

        console.log('🔄 Actualizando estado de docente:', { assignmentId, teacherId, status });

        // Validar estado
        const validStatuses = ['completed', 'completed-late', 'not-delivered', 'pending'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Estado no válido'
            });
        }

        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Asignación no encontrada'
            });
        }

        // Verificar que el docente está asignado a esta asignación
        const isAssigned = assignment.assignedTo.some(id => id.toString() === teacherId);
        if (!isAssigned) {
            return res.status(400).json({
                success: false,
                error: 'El docente no está asignado a esta asignación'
            });
        }

        const now = new Date();
        
        // Mapear estados del frontend al sistema interno del backend
        let submissionStatus = 'on-time'; 
        let responseStatus = 'submitted';
        let submittedAt = null;

        switch (status) {
            case 'completed':
                submissionStatus = 'on-time';  
                responseStatus = 'submitted';
                submittedAt = now; // Marcar como entregado ahora
                break;
            case 'completed-late':
                submissionStatus = 'late';     
                responseStatus = 'submitted';
                submittedAt = now; // Marcar como entregado tarde ahora
                break;
            case 'not-delivered':
                submissionStatus = 'closed';   
                responseStatus = 'reviewed';   // Marcado como revisado porque no se entregó
                submittedAt = null; // Sin fecha de entrega
                break;
            case 'pending':
                // Para pendiente, eliminar la respuesta existente en lugar de crearla
                submissionStatus = null;  
                responseStatus = null;
                submittedAt = null;
                break;
        }

        // Buscar respuesta existente del docente
        let teacherResponse = assignment.responses.find(r => 
            r.user.toString() === teacherId
        );

        if (status === 'pending') {
            // Si se establece como pendiente, eliminar la respuesta existente
            if (teacherResponse) {
                assignment.responses = assignment.responses.filter(r => 
                    r.user.toString() !== teacherId
                );
            }
        } else {
            // Para otros estados, crear o actualizar la respuesta
            if (teacherResponse) {
                // Actualizar respuesta existente
                teacherResponse.submissionStatus = submissionStatus;
                teacherResponse.status = responseStatus;
                teacherResponse.submittedAt = submittedAt;
            } else {
                // Crear nueva respuesta
                assignment.responses.push({
                    user: teacherId,
                    files: [],
                    submittedAt: submittedAt,
                    submissionStatus: submissionStatus,
                    status: responseStatus
                });
            }
        }

        // Actualizar timestamp de modificación
        assignment.updatedAt = now;
        assignment.updatedBy = req.user._id;

        // NO actualizar el estado base de la asignación para mantener la individualidad
        // El estado se maneja por respuestas individuales, no por el estado general
        await assignment.save();

        console.log('✅ Estado de docente actualizado exitosamente:', {
            assignmentTitle: assignment.title,
            teacherId,
            newStatus: status,
            submissionStatus,
            responseStatus,
            submittedAt
        });

        res.json({
            success: true,
            message: `Estado del docente actualizado a "${status}" exitosamente`,
            data: {
                assignmentId: assignment._id,
                teacherId,
                status,
                submissionStatus,
                responseStatus,
                submittedAt,
                updatedAt: now
            }
        });

    } catch (error) {
        console.error('❌ Error actualizando estado del docente:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
};

// FUNCIÓN COMENTADA: Esta función actualizaba el estado base de toda la asignación
// pero necesitamos mantener estados individuales por docente sin afectar a otros
/*
// Función auxiliar para actualizar el estado base de la asignación según las respuestas individuales
async function updateAssignmentStatusBasedOnResponses(assignment) {
    try {
        console.log(`🔄 Actualizando estado base de la asignación "${assignment.title}"`);
        
        // Si no hay docentes asignados, mantener el estado actual
        if (!assignment.assignedTo || assignment.assignedTo.length === 0) {
            console.log('   ⚪ No hay docentes asignados, manteniendo estado actual');
            return;
        }

        // Contar respuestas por tipo
        const responseStats = {
            total: assignment.responses.length,
            completed: 0,
            completedLate: 0,
            notDelivered: 0,
            pending: assignment.assignedTo.length
        };

        // Analizar cada respuesta
        assignment.responses.forEach(response => {
            if (response.submissionStatus === 'on-time' && response.status === 'submitted') {
                responseStats.completed++;
                responseStats.pending--;
            } else if (response.submissionStatus === 'late' && response.status === 'submitted') {
                responseStats.completedLate++;
                responseStats.pending--;
            } else if (response.submissionStatus === 'closed') {
                responseStats.notDelivered++;
                responseStats.pending--;
            }
        });

        console.log('   ��� Estadísticas de respuestas:', responseStats);

        // Determinar el nuevo estado base
        let newBaseStatus = assignment.status; // Estado actual por defecto

        // NUEVA LÓGICA: Más flexible para filtros de administrador
        // Priorizar estados que permitan que las asignaciones aparezcan en filtros apropiados
        
        if (responseStats.completed > 0) {
            // Si hay al menos una entrega completada a tiempo, marcar como 'completed'
            // Esto permite que aparezca en el filtro "Completadas" del admin
            newBaseStatus = 'completed';
            console.log('   💡 Hay entregas completadas -> estado "completed"');
        } else if (responseStats.completedLate > 0) {
            // Si hay entregas tardías pero ninguna a tiempo, marcar como 'completed-late'
            newBaseStatus = 'completed-late';
            console.log('   💡 Hay entregas tardías -> estado "completed-late"');
        } else if (responseStats.notDelivered > 0 && responseStats.pending === 0) {
            // Si todos los docentes asignados están marcados como no-entregados
            newBaseStatus = 'not-delivered';
            console.log('   💡 Todos marcados como no-entregados -> estado "not-delivered"');
        } else if (responseStats.notDelivered > 0 && responseStats.pending > 0) {
            // Hay algunos no-entregados pero otros aún pendientes
            newBaseStatus = 'pending';
            console.log('   💡 Mezcla de no-entregados y pendientes -> estado "pending"');
        } else {
            // Sin respuestas o solo pendientes
            newBaseStatus = 'pending';
            console.log('   💡 Sin respuestas definidas -> estado "pending"');
        }

        // Actualizar solo si cambió
        if (newBaseStatus !== assignment.status) {
            console.log(`   🔄 Cambiando estado base: "${assignment.status}" -> "${newBaseStatus}"`);
            assignment.status = newBaseStatus;
        } else {
            console.log(`   ✅ Estado base se mantiene: "${assignment.status}"`);
        }

    } catch (error) {
        console.error('❌ Error actualizando estado base de asignación:', error);
    }
}
*/
